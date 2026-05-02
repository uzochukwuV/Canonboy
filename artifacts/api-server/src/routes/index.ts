import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketsRouter from "./markets";
import signalsRouter from "./signals";
import tradesRouter from "./trades";
import botRouter from "./bot";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketsRouter);
router.use(signalsRouter);
router.use(tradesRouter);
router.use(botRouter);

export default router;
