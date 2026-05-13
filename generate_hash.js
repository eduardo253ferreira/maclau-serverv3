const bcrypt = require("bcrypt");

const password = "adminmaclau2026!";

async function gerarHash() {
  const hash = await bcrypt.hash(password, 10);
  console.log("🔐 Hash bcrypt:");
  console.log(hash);
}

gerarHash();
