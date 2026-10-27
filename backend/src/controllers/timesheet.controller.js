import * as timesheetService from '../services/timesheet.service.js';
import { timesheetQuerySchema } from '../validators/timesheet.validator.js';

export const getTimesheet = async (req, res) => {
  const query = timesheetQuerySchema.parse(req.query);
  res.json(await timesheetService.getWeek(req.user.id, query));
};
