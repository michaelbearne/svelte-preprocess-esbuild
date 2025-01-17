const { readFile, existsSync } = require('fs');
const { dirname, resolve } = require('path');
const esbuild = require('esbuild');
const { promisify } = require('util');
const read = promisify(readFile);
let decided = false;
let service;
function isWatcher() {
  const {ROLLUP_WATCH, WEBPACK_DEV_SERVER, CI, NODE_ENV} = process.env;
  if (CI != null)
    return false;
  if (ROLLUP_WATCH || WEBPACK_DEV_SERVER)
    return true;
  return !/^(prod|test)/.test(NODE_ENV) && /^(dev|local)/.test(NODE_ENV);
}
async function decide() {
  decided = true;
  if (isWatcher()) {
    service = await esbuild.startService();
  }
}
const isExternal = /^(https?:)?\/\//;
const isString = (x) => typeof x === "string";
function isTypescript(attrs) {
  if (isString(attrs.lang))
    return /^(ts|typescript)$/.test(attrs.lang);
  if (isString(attrs.type))
    return /^(text|application)[/](ts|typescript)$/.test(attrs.type);
  if (isString(attrs.src) && !isExternal.test(attrs.src))
    return /\.ts$/.test(attrs.src);
}
function bail(err, ...args) {
  console.error("[esbuild]", ...args);
  console.error(err.stack || err);
  process.exit(1);
}
async function transform(input, options) {
  let config = options;
  let deps = [];
  if (input.filename) {
    let src = input.attributes.src;
    config = {...config, sourcefile: input.filename};
    if (isString(src) && !isExternal.test(src)) {
      src = resolve(dirname(input.filename), src);
      if (existsSync(src)) {
        input.content = await read(src, "utf8");
        deps.push(src);
      } else {
        console.warn('[esbuild] Could not find "%s" file', src);
      }
    }
  }
  let output = await (service || esbuild).transform(input.content, config);
  if (output.warnings.length > 0) {
    console.log(output.warnings);
  }
  return {
    code: output.code,
    dependencies: deps,
    map: output.map
  };
}
function typescript(options = {}) {
  let {tsconfig, loglevel = "error", ...config} = options;
  config = {
    charset: "utf8",
    logLevel: loglevel,
    sourcemap: true,
    ...config,
    loader: "ts",
    format: "esm",
    minify: false
  };
  let contents;
  if (config.tsconfigRaw) {
    contents = config.tsconfigRaw;
  } else {
    let file = resolve(tsconfig || "tsconfig.json");
    try {
      contents = require(file);
    } catch (err) {
      if (err.code !== "MODULE_NOT_FOUND") {
        return bail(err, 'Error while parsing "tsconfig" file:', file);
      }
      if (tsconfig) {
        return bail(err, "Unable to load `tsconfig` file:", file);
      }
      console.warn('[esbuild] Attempted to autoload "tsconfig.json" – failed!');
      contents = {extends: true};
    }
  }
  if (!contents.compilerOptions && !contents.extends) {
    console.warn("[esbuild] Missing `compilerOptions` configuration – skip!");
  }
  let compilerOptions = {...contents.compilerOptions};
  compilerOptions.importsNotUsedAsValues = "preserve";
  config.tsconfigRaw = {compilerOptions};
  const define = config.define;
  return {
    async script(input) {
      decided || await decide();
      let bool = !!isTypescript(input.attributes);
      if (!bool && !!define)
        return transform(input, {define, loader: "js"});
      if (!bool)
        return {code: input.content};
      return transform(input, config);
    }
  };
}
function replace(define = {}) {
  for (let key in define) {
    define[key] = String(define[key]);
  }
  return {
    async script(input) {
      decided || await decide();
      let bool = !!isTypescript(input.attributes);
      if (bool)
        return {code: input.content};
      return transform(input, {define, loader: "js"});
    }
  };
}
module.exports = {
  replace,
  typescript
};
