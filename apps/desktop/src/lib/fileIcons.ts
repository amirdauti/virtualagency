/**
 * VS Code-like file icon color mapping
 * Maps file extensions to icon colors similar to the VS Code file icon theme
 */

export interface FileIconInfo {
  color: string;
  label: string;
}

// Extension to icon color mapping (VS Code Material Icon Theme inspired)
const extensionColors: Record<string, FileIconInfo> = {
  // JavaScript/TypeScript
  js: { color: '#f7df1e', label: 'JavaScript' },
  jsx: { color: '#61dafb', label: 'React JSX' },
  ts: { color: '#3178c6', label: 'TypeScript' },
  tsx: { color: '#3178c6', label: 'React TSX' },
  mjs: { color: '#f7df1e', label: 'ES Module' },
  cjs: { color: '#f7df1e', label: 'CommonJS' },

  // Web
  html: { color: '#e34c26', label: 'HTML' },
  htm: { color: '#e34c26', label: 'HTML' },
  css: { color: '#264de4', label: 'CSS' },
  scss: { color: '#cc6699', label: 'SCSS' },
  sass: { color: '#cc6699', label: 'Sass' },
  less: { color: '#1d365d', label: 'Less' },
  vue: { color: '#42b883', label: 'Vue' },
  svelte: { color: '#ff3e00', label: 'Svelte' },

  // Data/Config
  json: { color: '#cbcb41', label: 'JSON' },
  jsonc: { color: '#cbcb41', label: 'JSON with Comments' },
  json5: { color: '#cbcb41', label: 'JSON5' },
  yaml: { color: '#cb171e', label: 'YAML' },
  yml: { color: '#cb171e', label: 'YAML' },
  toml: { color: '#9c4121', label: 'TOML' },
  xml: { color: '#e37933', label: 'XML' },
  csv: { color: '#89e051', label: 'CSV' },

  // Documentation
  md: { color: '#519aba', label: 'Markdown' },
  mdx: { color: '#fcb32c', label: 'MDX' },
  txt: { color: '#89898a', label: 'Text' },
  pdf: { color: '#fb4141', label: 'PDF' },
  doc: { color: '#185abd', label: 'Word' },
  docx: { color: '#185abd', label: 'Word' },

  // Programming Languages
  py: { color: '#3776ab', label: 'Python' },
  pyw: { color: '#3776ab', label: 'Python' },
  rb: { color: '#cc342d', label: 'Ruby' },
  go: { color: '#00add8', label: 'Go' },
  rs: { color: '#dea584', label: 'Rust' },
  java: { color: '#b07219', label: 'Java' },
  kt: { color: '#a97bff', label: 'Kotlin' },
  swift: { color: '#f05138', label: 'Swift' },
  c: { color: '#555555', label: 'C' },
  cpp: { color: '#f34b7d', label: 'C++' },
  cc: { color: '#f34b7d', label: 'C++' },
  h: { color: '#a074c4', label: 'C Header' },
  hpp: { color: '#a074c4', label: 'C++ Header' },
  cs: { color: '#178600', label: 'C#' },
  php: { color: '#777bb4', label: 'PHP' },
  lua: { color: '#000080', label: 'Lua' },
  r: { color: '#198ce7', label: 'R' },
  scala: { color: '#c22d40', label: 'Scala' },
  dart: { color: '#00b4ab', label: 'Dart' },
  elm: { color: '#60b5cc', label: 'Elm' },
  ex: { color: '#6e4a7e', label: 'Elixir' },
  exs: { color: '#6e4a7e', label: 'Elixir Script' },
  erl: { color: '#b83998', label: 'Erlang' },
  hrl: { color: '#b83998', label: 'Erlang Header' },
  clj: { color: '#63b132', label: 'Clojure' },
  hs: { color: '#5e5086', label: 'Haskell' },
  ml: { color: '#e37933', label: 'OCaml' },
  fs: { color: '#b845fc', label: 'F#' },
  nim: { color: '#ffe953', label: 'Nim' },
  zig: { color: '#f7a41d', label: 'Zig' },

  // Shell/Scripts
  sh: { color: '#89e051', label: 'Shell' },
  bash: { color: '#89e051', label: 'Bash' },
  zsh: { color: '#89e051', label: 'Zsh' },
  fish: { color: '#89e051', label: 'Fish' },
  ps1: { color: '#012456', label: 'PowerShell' },
  bat: { color: '#c1f12e', label: 'Batch' },
  cmd: { color: '#c1f12e', label: 'Command' },

  // Build/Config files
  dockerfile: { color: '#2496ed', label: 'Dockerfile' },
  makefile: { color: '#6d8086', label: 'Makefile' },
  cmake: { color: '#064f8c', label: 'CMake' },
  gradle: { color: '#02303a', label: 'Gradle' },

  // Images
  png: { color: '#a074c4', label: 'PNG Image' },
  jpg: { color: '#a074c4', label: 'JPEG Image' },
  jpeg: { color: '#a074c4', label: 'JPEG Image' },
  gif: { color: '#a074c4', label: 'GIF Image' },
  svg: { color: '#ffb13b', label: 'SVG' },
  ico: { color: '#a074c4', label: 'Icon' },
  webp: { color: '#a074c4', label: 'WebP Image' },
  bmp: { color: '#a074c4', label: 'Bitmap' },

  // Audio/Video
  mp3: { color: '#ff5722', label: 'MP3 Audio' },
  wav: { color: '#ff5722', label: 'WAV Audio' },
  ogg: { color: '#ff5722', label: 'OGG Audio' },
  mp4: { color: '#ff5722', label: 'MP4 Video' },
  webm: { color: '#ff5722', label: 'WebM Video' },
  avi: { color: '#ff5722', label: 'AVI Video' },

  // Fonts
  ttf: { color: '#ff5722', label: 'TrueType Font' },
  otf: { color: '#ff5722', label: 'OpenType Font' },
  woff: { color: '#ff5722', label: 'Web Font' },
  woff2: { color: '#ff5722', label: 'Web Font 2' },
  eot: { color: '#ff5722', label: 'Embedded Font' },

  // Archives
  zip: { color: '#e6a937', label: 'ZIP Archive' },
  tar: { color: '#e6a937', label: 'TAR Archive' },
  gz: { color: '#e6a937', label: 'Gzip' },
  rar: { color: '#e6a937', label: 'RAR Archive' },
  '7z': { color: '#e6a937', label: '7-Zip' },

  // Other
  lock: { color: '#6d8086', label: 'Lock File' },
  log: { color: '#6d8086', label: 'Log File' },
  env: { color: '#faf743', label: 'Environment' },
  gitignore: { color: '#f05032', label: 'Git Ignore' },
  gitattributes: { color: '#f05032', label: 'Git Attributes' },
  editorconfig: { color: '#e0efef', label: 'Editor Config' },
  prettierrc: { color: '#56b3b4', label: 'Prettier' },
  eslintrc: { color: '#4b32c3', label: 'ESLint' },
  babelrc: { color: '#f5da55', label: 'Babel' },
  npmrc: { color: '#cb3837', label: 'NPM Config' },
  nvmrc: { color: '#339933', label: 'NVM Config' },
  sql: { color: '#e38c00', label: 'SQL' },
  graphql: { color: '#e10098', label: 'GraphQL' },
  gql: { color: '#e10098', label: 'GraphQL' },
  prisma: { color: '#0c344b', label: 'Prisma' },
  wasm: { color: '#654ff0', label: 'WebAssembly' },
};

// Special file names that get specific icons
const specialFileColors: Record<string, FileIconInfo> = {
  'package.json': { color: '#cb3837', label: 'NPM Package' },
  'package-lock.json': { color: '#cb3837', label: 'NPM Lock' },
  'pnpm-lock.yaml': { color: '#f9ad00', label: 'PNPM Lock' },
  'yarn.lock': { color: '#2c8ebb', label: 'Yarn Lock' },
  'tsconfig.json': { color: '#3178c6', label: 'TypeScript Config' },
  'jsconfig.json': { color: '#f7df1e', label: 'JavaScript Config' },
  'vite.config.ts': { color: '#646cff', label: 'Vite Config' },
  'vite.config.js': { color: '#646cff', label: 'Vite Config' },
  'webpack.config.js': { color: '#8dd6f9', label: 'Webpack Config' },
  'rollup.config.js': { color: '#ef3335', label: 'Rollup Config' },
  '.gitignore': { color: '#f05032', label: 'Git Ignore' },
  '.gitattributes': { color: '#f05032', label: 'Git Attributes' },
  '.env': { color: '#faf743', label: 'Environment' },
  '.env.local': { color: '#faf743', label: 'Local Environment' },
  '.env.development': { color: '#faf743', label: 'Dev Environment' },
  '.env.production': { color: '#faf743', label: 'Prod Environment' },
  '.prettierrc': { color: '#56b3b4', label: 'Prettier' },
  '.prettierrc.json': { color: '#56b3b4', label: 'Prettier' },
  '.eslintrc': { color: '#4b32c3', label: 'ESLint' },
  '.eslintrc.json': { color: '#4b32c3', label: 'ESLint' },
  '.eslintrc.js': { color: '#4b32c3', label: 'ESLint' },
  'eslint.config.js': { color: '#4b32c3', label: 'ESLint Config' },
  'eslint.config.mjs': { color: '#4b32c3', label: 'ESLint Config' },
  '.babelrc': { color: '#f5da55', label: 'Babel' },
  'babel.config.js': { color: '#f5da55', label: 'Babel Config' },
  'Dockerfile': { color: '#2496ed', label: 'Dockerfile' },
  'docker-compose.yml': { color: '#2496ed', label: 'Docker Compose' },
  'docker-compose.yaml': { color: '#2496ed', label: 'Docker Compose' },
  'Makefile': { color: '#6d8086', label: 'Makefile' },
  'CMakeLists.txt': { color: '#064f8c', label: 'CMake' },
  'Cargo.toml': { color: '#dea584', label: 'Cargo' },
  'Cargo.lock': { color: '#dea584', label: 'Cargo Lock' },
  'go.mod': { color: '#00add8', label: 'Go Module' },
  'go.sum': { color: '#00add8', label: 'Go Sum' },
  'requirements.txt': { color: '#3776ab', label: 'Python Requirements' },
  'Pipfile': { color: '#3776ab', label: 'Pipfile' },
  'Pipfile.lock': { color: '#3776ab', label: 'Pipfile Lock' },
  'pyproject.toml': { color: '#3776ab', label: 'Python Project' },
  'Gemfile': { color: '#cc342d', label: 'Gemfile' },
  'Gemfile.lock': { color: '#cc342d', label: 'Gemfile Lock' },
  'README.md': { color: '#519aba', label: 'Readme' },
  'README': { color: '#519aba', label: 'Readme' },
  'LICENSE': { color: '#d4af37', label: 'License' },
  'LICENSE.md': { color: '#d4af37', label: 'License' },
  'CHANGELOG.md': { color: '#519aba', label: 'Changelog' },
  'CONTRIBUTING.md': { color: '#519aba', label: 'Contributing' },
  '.npmrc': { color: '#cb3837', label: 'NPM Config' },
  '.nvmrc': { color: '#339933', label: 'NVM Config' },
  '.editorconfig': { color: '#e0efef', label: 'Editor Config' },
  'turbo.json': { color: '#ef4444', label: 'Turbo' },
  'vercel.json': { color: '#000000', label: 'Vercel' },
  'netlify.toml': { color: '#00c7b7', label: 'Netlify' },
  'tailwind.config.js': { color: '#38bdf8', label: 'Tailwind' },
  'tailwind.config.ts': { color: '#38bdf8', label: 'Tailwind' },
  'postcss.config.js': { color: '#dd3a0a', label: 'PostCSS' },
  'postcss.config.cjs': { color: '#dd3a0a', label: 'PostCSS' },
  'next.config.js': { color: '#000000', label: 'Next.js' },
  'next.config.mjs': { color: '#000000', label: 'Next.js' },
  'nuxt.config.ts': { color: '#00dc82', label: 'Nuxt' },
  'svelte.config.js': { color: '#ff3e00', label: 'Svelte' },
  'astro.config.mjs': { color: '#ff5d01', label: 'Astro' },
  'vitest.config.ts': { color: '#729b1b', label: 'Vitest' },
  'jest.config.js': { color: '#99425b', label: 'Jest' },
  'jest.config.ts': { color: '#99425b', label: 'Jest' },
  'playwright.config.ts': { color: '#2ead33', label: 'Playwright' },
  'cypress.config.ts': { color: '#17202c', label: 'Cypress' },
  '.dockerignore': { color: '#2496ed', label: 'Docker Ignore' },
};

// Folder colors
const folderColors: Record<string, string> = {
  src: '#89b4fa',
  source: '#89b4fa',
  lib: '#a6e3a1',
  libs: '#a6e3a1',
  dist: '#f9e2af',
  build: '#f9e2af',
  out: '#f9e2af',
  output: '#f9e2af',
  node_modules: '#6c7086',
  vendor: '#6c7086',
  packages: '#cba6f7',
  components: '#f5c2e7',
  pages: '#94e2d5',
  routes: '#94e2d5',
  api: '#fab387',
  hooks: '#89dceb',
  utils: '#74c7ec',
  helpers: '#74c7ec',
  services: '#b4befe',
  stores: '#f38ba8',
  store: '#f38ba8',
  state: '#f38ba8',
  styles: '#cba6f7',
  css: '#cba6f7',
  assets: '#f5e0dc',
  images: '#f5e0dc',
  img: '#f5e0dc',
  public: '#eba0ac',
  static: '#eba0ac',
  tests: '#a6e3a1',
  test: '#a6e3a1',
  __tests__: '#a6e3a1',
  spec: '#a6e3a1',
  specs: '#a6e3a1',
  config: '#f9e2af',
  configs: '#f9e2af',
  types: '#89b4fa',
  interfaces: '#89b4fa',
  models: '#f38ba8',
  entities: '#f38ba8',
  controllers: '#fab387',
  middleware: '#94e2d5',
  middlewares: '#94e2d5',
  docs: '#89b4fa',
  documentation: '#89b4fa',
  scripts: '#a6e3a1',
  bin: '#a6e3a1',
  '.git': '#f05032',
  '.github': '#6e5494',
  '.vscode': '#007acc',
  '.idea': '#fe315d',
};

/**
 * Get file icon info based on filename
 */
export function getFileIconInfo(filename: string): FileIconInfo {
  // Check special file names first
  const lowerFilename = filename.toLowerCase();
  if (specialFileColors[filename]) {
    return specialFileColors[filename];
  }
  if (specialFileColors[lowerFilename]) {
    return specialFileColors[lowerFilename];
  }

  // Get extension
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  // Check if it's a dotfile with no extension
  if (filename.startsWith('.') && !filename.includes('.', 1)) {
    const dotFileName = filename.slice(1).toLowerCase();
    if (extensionColors[dotFileName]) {
      return extensionColors[dotFileName];
    }
  }

  if (extensionColors[ext]) {
    return extensionColors[ext];
  }

  // Default file color
  return { color: '#6c7086', label: 'File' };
}

/**
 * Get folder icon color based on folder name
 */
export function getFolderColor(folderName: string): string {
  const lowerName = folderName.toLowerCase();
  return folderColors[lowerName] || '#89b4fa'; // Default folder blue
}

/**
 * Check if file is a special configuration file
 */
export function isConfigFile(filename: string): boolean {
  const configPatterns = [
    /\.config\.(js|ts|mjs|cjs)$/,
    /^(tsconfig|jsconfig).*\.json$/,
    /^\.(eslintrc|prettierrc|babelrc)/,
    /^(vite|webpack|rollup|next|nuxt)\.config/,
  ];
  return configPatterns.some(pattern => pattern.test(filename));
}
