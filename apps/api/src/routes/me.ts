import { Router } from "express";
import { ah } from "../http.js";
import { loadAccounts } from "../services/data.js";

export const meRouter = Router();

meRouter.get("/me", ah(async (req, res) => {
  const accounts = await loadAccounts();
  res.json({ user: req.user, accounts: accounts.map(a => ({ code: a.code, ownerName: a.ownerName })) });
}));
