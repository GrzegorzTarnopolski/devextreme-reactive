const {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
} = require('fs');
const { join } = require('path');

const ROOT_PATH = join(process.cwd(), 'packages');
const SOURCE_FOLDER = 'docs/reference';
const TARGET_FOLDER = 'dist';
const PLUGINS_FOLDER = 'plugins';

const getComponentName = fileName => fileName
  .replace('.md', '')
  .split('-')
  .reduce((acc, element) =>
    acc + element.charAt(0).toUpperCase() + element.slice(1), '');

const cleanElement = element => element.trim()
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&#124;/g, '|')
  .replace(/\[([.\w\s]+)\]/g, '$1')
  .replace(/\([/#.\w\s-]+\)/g, '');

const tsReplace = element => element
  .replace(/ReactNode/g, 'React.ReactNode')
  .replace(/ComponentType/g, 'React.ComponentType')
  .replace(/ReactInstance/g, 'React.ReactInstance')
  .replace(/\[key: number \| string\]:/, '[key: string]:')
  .replace(/\[key: GroupKey\]:/, '[key: string]:');

const getFormattedLine = (line, level = 1) => {
  const elements = line.split('|')
    .map(element => tsReplace(cleanElement(element)));
  const descriptionIndex = elements.length - 1;
  const indent = ' '.repeat(level * 2);
  return `${indent}/** ${elements[descriptionIndex]} */\n${indent}${elements[0]}: ${elements[1]};\n`;
};

const getBlockEnd = (source) => {
  const end = source.findIndex(el => el.indexOf('## ') === 0 || el.indexOf('# ') === 0);
  return end === -1 ? source.length : end;
};

const parseFile = (source) => {
  let description = cleanElement(source
    .slice(1, source.findIndex(el => el.indexOf('## ') === 0))
    .join(''));

  let propertiesBlock = source.slice(source.indexOf('### Properties') + 1);
  propertiesBlock = propertiesBlock
    .slice(0, getBlockEnd(propertiesBlock))
    .filter(element => element !== 'none');

  let interfacesBlock = source.slice(source.indexOf('## Interfaces') + 1);
  interfacesBlock = interfacesBlock
    .slice(0, getBlockEnd(interfacesBlock))
    .reduce((acc, line) => {
      const nameMatches = /^###\s([\w.]+)/.exec(line);
      const name = nameMatches && nameMatches[1];
      const lastItemIndex = acc.length - 1;
      if (name) {
        return [...acc, { name, description: '', properties: [] }];
      }
      if (!line.match(/.+\|.+\|.+/)) {
        if (line.indexOf('Type: ') === 0) {
          acc[lastItemIndex].type = cleanElement(line.match(/\`([.\w]+)\`/)[1]);
        } else if (line.indexOf('Extends ') === 0) {
          acc[lastItemIndex].extension = cleanElement(line.match(/\[[.\w]+\]/)[0]);
        } else {
          acc[lastItemIndex].description += cleanElement(line);
        }
        return acc;
      }
      acc[lastItemIndex].properties.push(line);
      return acc;
    }, []);

  let componentsBlock = source.slice(source.indexOf('## Plugin Components') + 1);
  componentsBlock = componentsBlock.slice(0, getBlockEnd(componentsBlock))
    .filter(line => line.match(/.+\|.+\|.+/));

  let staticFieldsBlock = source.slice(source.indexOf('## Static Fields') + 1);
  staticFieldsBlock = staticFieldsBlock.slice(0, getBlockEnd(staticFieldsBlock))
    .filter(line => line.match(/.+\|.+\|.+/));

  let messagesBlock = source.slice(source.indexOf('## Localization Messages') + 1);
  messagesBlock = messagesBlock
    .slice(0, getBlockEnd(messagesBlock))
    .filter(line => line.match(/.+\|.+\|.+/));

  return {
    description,
    properties: propertiesBlock,
    interfaces: interfacesBlock,
    pluginComponents: componentsBlock,
    staticFields: staticFieldsBlock,
    localizationMessages: messagesBlock,
  };
};

const getInterfaceExport = ({
  name,
  description,
  properties,
  extension,
}, level = 0) => {
  const indent = ' '.repeat(2 * level);
  const extensionText = extension ? ` extends ${extension}` : '';
  const propertiesText = properties
    .reduce((acc, propLine) => acc + getFormattedLine(propLine, level + 1), '');
  return `${indent}/** ${description} */\n`
    + `${indent}export interface ${name}${extensionText} {\n`
    + `${propertiesText}`
    + `${indent}}\n`;
};

const generateTypeScript = (data, componentName) => {
  const interfaces = data.interfaces.reduce((acc, currentInterface) => {
    const { name, type, description } = currentInterface;
    if (type) {
      return `${acc}/** ${description} */\n` +
        `export type ${name} = ${type};\n\n`;
    }
    if (name.indexOf('.') !== -1) {
      const [namespace, interfaceName] = name.split('.');
      return `${acc}export namespace ${namespace} {\n`
        + `${getInterfaceExport({ ...currentInterface, name: interfaceName }, 1)}`
        + '}\n\n';
    }
    return `${acc}${getInterfaceExport(currentInterface)}\n`;
  }, '');
  const localizationMessages = data.localizationMessages
    .reduce((acc, line) => acc + getFormattedLine(line, 2), '');
  const properties = data.properties
    .reduce((acc, line) => acc + getFormattedLine(line), '');

  let result = interfaces;

  if (localizationMessages.length) {
    result += `export namespace ${componentName} {\n`
    + '  export interface LocalizationMessages {\n'
    + `${localizationMessages}`
    + '  }\n'
    + '}\n\n';
  }

  const staticFields = data.staticFields
    .reduce((acc, line) => acc
      + getFormattedLine(line), '');

  result += `export interface ${componentName}Props {\n`
    + `${properties}`
    + '}\n\n'
    + `/** ${data.description} */\n`
    + `export declare const ${componentName}: React.ComponentType<${componentName}Props>`
    + `${staticFields.length ? ` & {\n${staticFields}}` : ''}`
    + ';\n';

  return result;
};

const getThemesTypeScript = (data, componentName, packageName) => {
  const interfaces = data.interfaces.reduce((acc, currentInterface) => {
    const { name, description } = currentInterface;
    if (name.indexOf('.') !== -1) {
      const [namespace, interfaceName] = name.split('.');
      const baseName = name
        .replace(`${componentName}.`, `${componentName}Base.`)
        .replace('Table.', 'TableBase.')
        .replace('TableHeaderRow.', 'TableHeaderRowBase.');
      return `${acc}export namespace ${namespace} {\n`
        + `  /** ${description} */\n`
        + `  export type ${interfaceName} = ${baseName};\n`
        + '}\n\n';
    }
    return acc;
  }, '');

  const properties = data.properties
    .reduce((acc, line) => {
      let result = acc
        + getFormattedLine(line)
          .replace(`${componentName}.`, `${componentName}Base.`)
          .replace('Table.', 'TableBase.')
          .replace('TableHeaderRow.', 'TableHeaderRowBase.');
      if (componentName !== 'Grid') {
        result = result.replace(/(\s\s\w+):/g, '$1?:');
      } else {
        result = result.replace(/(\s\s\w+Component):/g, '$1?:');
      }
      return result;
    }, '');

  const staticFields = data.staticFields
    .reduce((acc, line) => acc
      + getFormattedLine(line), '');

  const pluginComponents = data.pluginComponents
    .reduce((acc, line) => acc
      + getFormattedLine(line)
        .replace(/\w+\.(\w+:\s)(.+);/, '$1React.ComponentType<$2>;')
        .replace(`${componentName}.`, `${componentName}Base.`)
        .replace('Table.', 'TableBase.')
        .replace('TableHeaderRow.', 'TableHeaderRowBase.'), '')
        .replace(/(\w+: React\.ComponentType<.*)>/g, '$1 & { className?: string; style?: React.CSSProperties; [x: string]: any }>');

  return 'import {\n'
    + `  ${componentName} as ${componentName}Base,\n`
    + `} from \'@devexpress/${packageName}\';\n\n`
    + `${interfaces.length ? `\n${interfaces}` : ''}`
    + `export interface ${componentName}Props {\n`
    + `${properties}`
    + '}\n\n'
    + `/** ${data.description} */\n`
    + `export declare const ${componentName}: React.ComponentType<${componentName}Props>`
    + `${staticFields.length ? ` & {\n${staticFields}}` : ''}`
    + `${pluginComponents.length ? ` & {\n${pluginComponents}}` : ''};\n`;
};

const ensureDirectory = (dir) => {
  if (!existsSync(dir)) {
    mkdirSync(dir);
  }
};

const isNotRootComponent = (packageName, file) => {
  return (packageName.indexOf('grid') > 0 && file.indexOf('grid') === -1) ||
        (packageName.indexOf('chart') > 0 && file.indexOf('chart') === -1);
};

const generateTypeScriptForPackage = (packageName) => {
  let indexContent = 'import * as React from \'react\';\n';
  let themesIndexContent = '';
  const themesImports = [];
  const themes = readdirSync(ROOT_PATH)
    .filter(folder => folder.indexOf(`${packageName}-`) !== -1 && folder.indexOf(`demos`) === -1)
    .map((folder) => {
      const matches = new RegExp(`${packageName}-([\\w-]+)`).exec(folder);
      return matches[1];
    });

  readdirSync(join(ROOT_PATH, packageName, SOURCE_FOLDER)).forEach((file) => {
    const targetFileName = file.split('.')[0];
    const componentName = getComponentName(file);
    const fileContent = String(readFileSync(join(ROOT_PATH, packageName, SOURCE_FOLDER, file)))
      .split('\n')
      .filter(line => !!line && !/^(-+|Name|Field)\s?\|/.test(line));
    const fileData = parseFile(fileContent);

    indexContent += `\n// ${'-'.repeat(97)}\n// ${componentName}\n// ${'-'.repeat(97)}\n\n`;
    indexContent += generateTypeScript(fileData, componentName);

    if (!themes.length) return;

    const themeFile = join((isNotRootComponent(packageName, file) ? PLUGINS_FOLDER : ''), targetFileName);
    const targetThemeFolder = join(ROOT_PATH, `${packageName}-${themes[0]}`, 'src');
    if (existsSync(join(targetThemeFolder, `${themeFile}.jsx`))) {
      fileData.properties
        .reduce((acc, line) => {
          const matches = /\[(\w+)(?:\.\w+)?\]\(.*#.*\)/.exec(line);
          if (matches !== null && matches[1] !== componentName
            && matches[1] !== 'Table' && matches[1] !== 'TableHeaderRow'
            && acc.indexOf(matches[1]) === -1) {
            acc.push(matches[1]);
          }
          return acc;
        }, [])
        .forEach((element) => {
          if (themesImports.indexOf(element) === -1) {
            themesImports.push(element);
          }
        });

      themesIndexContent += `\n// ${'-'.repeat(97)}\n// ${componentName}\n// ${'-'.repeat(97)}\n\n`;
      themesIndexContent += getThemesTypeScript(fileData, componentName, packageName);
    }
  });

  themesIndexContent = 'import * as React from \'react\';\n'
    + 'import {\n'
    + `  ${themesImports.join(',\n  ')}`
    + `\n} from \'@devexpress/${packageName}\';\n`
    + `${themesIndexContent}`;

  console.log(`Building TypeScript definitions for \'${packageName}\'.`);
  const distFolder = join(ROOT_PATH, packageName, TARGET_FOLDER);
  ensureDirectory(distFolder);
  writeFileSync(join(distFolder, `${packageName}.d.ts`), indexContent);

  themes.forEach((theme) => {
    console.log(`Building TypeScript definitions for '${packageName}-${theme}'.`);
    const themeDistFolder = join(ROOT_PATH, `${packageName}-${theme}`, TARGET_FOLDER);
    ensureDirectory(themeDistFolder);
    writeFileSync(
      join(themeDistFolder, `${packageName}-${theme}.d.ts`),
      themesIndexContent,
    );
  });
};

generateTypeScriptForPackage('dx-react-core');
generateTypeScriptForPackage('dx-react-grid');
generateTypeScriptForPackage('dx-react-chart');