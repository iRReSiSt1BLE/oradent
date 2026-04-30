"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const projectRoot = node_path_1.default.resolve(__dirname, '..');
const assets = [
    ['src/renderer/index.html', 'dist/renderer/index.html'],
    ['src/renderer/styles.css', 'dist/renderer/styles.css'],
];
for (const [from, to] of assets) {
    const sourcePath = node_path_1.default.join(projectRoot, from);
    const targetPath = node_path_1.default.join(projectRoot, to);
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(targetPath), { recursive: true });
    node_fs_1.default.copyFileSync(sourcePath, targetPath);
}
