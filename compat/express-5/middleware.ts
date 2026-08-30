import express from "express";
import { sitegate } from "sitegate/express";

export const app = express();

app.use(sitegate({ enabled: false }));
app.get("/health", (_request, response) => response.send("ok"));
