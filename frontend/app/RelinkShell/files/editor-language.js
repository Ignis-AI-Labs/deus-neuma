// Load only the grammar the opened file needs. Kept beside the editor so the
// window can prefetch it in parallel with the document and editor shell.

export const loadLanguageFor = (path) => {
  const ext = (path.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'js': case 'jsx': case 'mjs': case 'cjs':
      return import('@codemirror/lang-javascript').then(({ javascript }) => javascript({ jsx: true }));
    case 'ts': case 'tsx':
      return import('@codemirror/lang-javascript').then(({ javascript }) => javascript({ jsx: true, typescript: true }));
    case 'json': return import('@codemirror/lang-json').then(({ json }) => json());
    case 'html': case 'htm': return import('@codemirror/lang-html').then(({ html }) => html());
    case 'css': return import('@codemirror/lang-css').then(({ css }) => css());
    case 'md': case 'markdown': return import('@codemirror/lang-markdown').then(({ markdown }) => markdown());
    case 'py': return import('@codemirror/lang-python').then(({ python }) => python());
    default: return Promise.resolve([]);
  }
};
