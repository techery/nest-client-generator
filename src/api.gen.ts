import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Project, Scope, SyntaxKind } from 'ts-morph';
import * as defualtConfig from './config';
import { Config } from './config.interface';
export const startGenerateClientApi = (config: Config = defualtConfig) => {
    const clientPath = resolve(config.clientPath);
    const serverPath = resolve(config.serverPath);
    mkdirSync(clientPath, { recursive: true });
    writeFileSync(clientPath + '/http.service.ts', config.httpServiceTemplate);

    const project = new Project();
    const files = project.addExistingSourceFiles(serverPath + '/**/*controller.ts');

    files.forEach(file => {
        const c = file.getClasses()[0];
        const basePath = c
            .getDecorator('Controller')
            .getArguments()[0]
            .compilerNode.getText()
            .replace(/'/g, '');
        c.getDecorators().forEach(d => d.remove());
        c.getConstructors().forEach(constructor => constructor.remove());
        c.addConstructor({
            parameters: [
                {
                    isReadonly: true,
                    type: 'APIService',
                    name: 'api',
                    scope: Scope.Private,
                },
            ],
        });
        file.addImportDeclaration({
            namedImports: ['APIService'],
            moduleSpecifier: './http.service',
        });
        file.getImportStringLiterals()[0].getText();
        const methods = c.getMethods();
        methods.forEach(method => {
            let replacment = '';
            const retrunType = method.getReturnType();
            const returnTypeNode = method.getReturnTypeNode();
            let resolver = 'resolve(data)';
            if (!returnTypeNode) {
                method.setReturnType(retrunType.getText());
            }
            else {
                const type = method
                    .getReturnTypeNode()
                    .getText()
                    .replace('Promise<', '')
                    .replace('>', '');

                method.setReturnType(`Promise<${type}>`);

                if (type !== 'any' && !type.includes('{')) {
                    const isArray = type.includes('[]');
                    if (isArray) {
                        const arrayType = type.replace('[]', '');
                        resolver = `resolve(data.map(d => new ${arrayType}(d)))`;
                    }
                    else {
                        resolver = `resolve(new ${type}(data))`;
                    }
                }
            }
            method.getDecorators().forEach(d => {
                const name = d.getName();
                if (!config.decorators[name]) {
                    return d.remove();
                }
                const args = d.getArguments();
                const methodPath = args[0]
                    ? args[0].compilerNode
                        .getText()
                        .replace(/'/g, '')
                        .split(':')[0]
                    : '';
                const body = method
                    .getParameters()
                    .filter(p => p.getDecorators().find(d => d.getName() === 'Body'))
                    .map(p => p.compilerNode.name.getText())
                    .join(', ');
                    
                const model = method
                    .getParameters()
                    .filter(p => p.getDecorators().find(d => (d.getName() === 'Body' || d.getName() === 'Query') && d.getArguments().length == 0))
                    .map(p => p.compilerNode.name.getText())[0]
                console.log(model)
                replacment = config.decorators[name]
                    .replace('{url}', basePath + (methodPath ? '/' + methodPath : ''))
                    .replace('{body}', body ? ', ' + body : '')
                    .replace('{params}', model ? `, { params: ${model} }` : '');
                d.remove();
            }); 
            method.getParameters().forEach(p => {
                const bodyDecorator = p.getDecorators().find(d => d.getName() === 'Body' || d.getName() === 'Param' || d.getName() === 'Query');

                if (!bodyDecorator) {
                    return p.remove();
                }
                p.getDecorators().forEach(d => d.remove());
            });

            const implementation = method.getImplementation();

            replacment = replacment.replace('{resolve}', resolver);
            implementation.setBodyText(replacment);
        });

        file.fixMissingImports()
            .organizeImports()
            .formatText();
        writeFileSync(`${clientPath}/${file.getBaseName()}`, file.getText());
    });
};
