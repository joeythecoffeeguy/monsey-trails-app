import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tripRouter from "./trip";
import scheduleRouter from "./schedule";
import passengerInfoRouter from "./passenger-info";
import mapTilesRouter from "./map-tiles";
import trafficRouter from "./traffic";
import passengerAlertsRouter from "./passenger-alerts";
import driverProfileRouter from "./driver-profile";
import adminDriversRouter from "./admin-drivers";
import adminStopsRouter from "./admin-stops";
import publicSchedulesRouter from "./public-schedules";
import passengerTransfersRouter from "./passenger-transfers";
import adminDisruptionsRouter from "./admin-disruptions";
import adminOperationsRouter from "./admin-operations";
import operationsCommunicationsRouter from "./operations-communications";
import departureRemindersRouter from "./departure-reminders";
import adminNotificationsRouter from "./admin-notifications";
import adminDisplaySettingsRouter from "./admin-display-settings";
import passengerCommunicationsRouter from "./passenger-communications";
import passengerRealtimeRouter from "./passenger-realtime";
import passengerLiveActivitiesRouter from "./passenger-live-activities";
import passengerAccountJourneysRouter from "./passenger-account-journeys";
import adminAccessRouter from "./admin-access";
import adminCoachDetailRouter from "./admin-coach-detail";
import adminIncidentsRouter from "./admin-incidents";

const router: IRouter = Router();

router.use(healthRouter);
router.use(driverProfileRouter);
// This router applies an explicit dispatch-capability policy before parsing.
// Keep it ahead of the legacy broad /admin router, which fails closed for
// administrator paths that it does not classify.
router.use(adminIncidentsRouter);
router.use(passengerCommunicationsRouter);
router.use(adminDriversRouter);
router.use(adminAccessRouter);
router.use(adminCoachDetailRouter);
router.use(adminStopsRouter);
router.use(adminDisruptionsRouter);
router.use(adminOperationsRouter);
router.use(operationsCommunicationsRouter);
router.use(publicSchedulesRouter);
router.use(passengerTransfersRouter);
router.use(tripRouter);
router.use(scheduleRouter);
router.use(passengerInfoRouter);
router.use(mapTilesRouter);
router.use(trafficRouter);
router.use(passengerAlertsRouter);
router.use(passengerRealtimeRouter);
router.use(passengerLiveActivitiesRouter);
router.use(passengerAccountJourneysRouter);
router.use(departureRemindersRouter);
router.use(adminNotificationsRouter);
router.use(adminDisplaySettingsRouter);

export default router;
