import "dotenv/config";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { makeStorage } from "./storage/index.js";
import { mongoRepo, connectMongo } from "./repo/mongo.js";

const config = loadConfig();
await connectMongo(config.mongoUri);
const app = createApp({ config, repo: mongoRepo(), storage: makeStorage(config) });
app.listen(config.port, () => console.log(`collector api on :${config.port} (storage: ${config.storageDriver})`));
