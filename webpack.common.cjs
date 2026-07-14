const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const webpack = require("webpack");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const NodePolyfillPlugin = require("node-polyfill-webpack-plugin");
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");
const ESLintPlugin = require("eslint-webpack-plugin");
require("dotenv").config({ path: "./.env" });
const config = {
  entry: {
    main: path.join(__dirname, "src", "index.tsx"),
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        resolve: {
          fullySpecified: false,
        }
      },
      {
        test: /\.(ts|tsx)$/,
        use: {
          loader: "ts-loader",
          options: {
            // Type checking runs in a separate process via
            // fork-ts-checker-webpack-plugin (see plugins below). This
            // also stops ts-loader from rebuilding compilation.errors,
            // which silently dropped other plugins' reports (it keeps
            // only webpack.WebpackError instances).
            transpileOnly: true,
          },
        },
        exclude: /node_modules/,
      },
      {
        test: /\.(jpe?g|png|gif|svg)$/i,
        type: "asset",
      },
      {
        test: /\.css$/i,
        include: path.resolve(__dirname, "src"),
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: "asset/resource",
      },
      {
        test: /\.mjs$/,
        include: /node_modules/,
        type: "javascript/auto",
        resolve: {
          fullySpecified: false,
        },
      },
      {
        test: /\.ya?ml$/,
        use: "yaml-loader",
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  resolve: {
    extensions: [".js", ".tsx", ".ts"],
    fallback: {
      fs: false,
    },
  },
  plugins: [
    new webpack.ProgressPlugin(),
    new CleanWebpackPlugin({
      verbose: true,
      cleanStaleWebpackAssets: true,
    }),
    new HtmlWebpackPlugin({
      template: path.join(__dirname, "src", "index.html"),
    }),
    new CopyPlugin({
      patterns: [{ from: "public" }],
    }),
    new CopyPlugin({
      patterns: [
        {
          from: path.join(__dirname, "public", "manifest.json"),
          to: path.join(__dirname, "build"),
          force: true,
          transform: function (content, path) {
            // generates the manifest file using the package.json information
            return Buffer.from(
              JSON.stringify({
                description: process.env.npm_package_description,
                version: process.env.npm_package_version,
                ...JSON.parse(content.toString()),
              })
            );
          },
        },
      ],
    }),
    new webpack.DefinePlugin({
      VERSION: JSON.stringify(require("./package.json").version),
      "process.env": JSON.stringify(process.env)
    }),
    new webpack.ProvidePlugin({
      Buffer: ["buffer", "Buffer"],
    }),
    new NodePolyfillPlugin(),
    // Type checks the src program in a separate process; the build
    // fails on type errors like it did when ts-loader checked types.
    // Tests are excluded: they are not part of the bundle and were not
    // type checked by ts-loader either (they sat outside the module
    // graph).
    new ForkTsCheckerWebpackPlugin({
      // Synchronous also in dev mode, so type errors block the dev
      // compilation exactly like they did when ts-loader checked types
      // (the dev server runs with the error overlay disabled).
      async: false,
      typescript: {
        configOverwrite: {
          include: ["src"],
          exclude: [
            "**/*.test.ts",
            "**/*.test.tsx",
            "**/*.spec.ts",
            "**/*.spec.tsx",
            "**/__tests__/**",
            "**/__mocks__/**",
          ],
        },
      },
    }),
    // Fails the build when src uses ES features unsupported by the
    // .browserslistrc targets, using the compat-only ESLint config.
    new ESLintPlugin({
      context: __dirname,
      files: "src",
      extensions: ["ts", "tsx"],
      // No result cache: ESLint's cache key hashes the ESLint config
      // only, so a .browserslistrc change would keep serving stale
      // "clean" results. This lint is type-aware (the compat config sets
      // parserOptions.project so es-x prototype-method rules such as
      // no-array-prototype-at can resolve receiver types), so it parses a
      // full TypeScript program on each run rather than being a cheap pass.
      cache: false,
      useEslintrc: false,
      overrideConfigFile: path.join(__dirname, ".eslintrc.compat.cjs"),
    }),
  ],
  infrastructureLogging: {
    level: "info",
  },
  experiments: {
    asyncWebAssembly: true,
  },
};

module.exports = config;
