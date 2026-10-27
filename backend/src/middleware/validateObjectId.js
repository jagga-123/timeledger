import { isValidObjectId } from '../utils/objectId.js';

// Use with router.param('id', validateObjectId) to reject malformed ids before hitting the database
export const validateObjectId = (req, res, next, id) => {
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid id' });
  }
  next();
};
