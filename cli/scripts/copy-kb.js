const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "..", "knowledge-base");
const dest = path.join(__dirname, "..", "dist", "knowledge-base");

fs.cpSync(src, dest, { recursive: true });
console.log(`Bundled knowledge base into ${dest}`);
