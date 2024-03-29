const path = require("path");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");

const outputDirectory = "dist";

module.exports = {
  entry: [ "babel-polyfill", "./lib/client/App.jsx" ],
  output: {
    path: path.join(__dirname, outputDirectory),
    filename: "bundle.js",
  },
  resolve: {
    extensions: [ ".js", ".jsx" ],
  },
  module: {
    rules: [
      {
        test: /\.jsx$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
        },
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
        },
      },
      {
        test: /\.css$/,
        use: [ "style-loader", "css-loader" ],
      },
      {
        test: /\.(png|woff|woff2|eot|ttf|svg)$/,
        loader: "url-loader",
        options: { limit: 100000 },
      },
    ],
  },
  devServer: {
    port: 3001,
    open: true,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  plugins: [ new CleanWebpackPlugin({ output: { path: path.join(__dirname, outputDirectory) } }) ],
};
