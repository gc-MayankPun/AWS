import express from "express";
import path from "path";
import { fileURLToPath } from "node:url";

const app = express();

const distDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "public",
);

app.use(express.static(distDir));
app.use((req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(3000, () => {
  console.log("Server listening on PORT 3000");
});
