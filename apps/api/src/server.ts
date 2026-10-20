import { config } from "./config.js";
import { createApp } from "./app.js";

createApp().listen(config.port, () => console.log(`Tradelog API listening on :${config.port}`));
