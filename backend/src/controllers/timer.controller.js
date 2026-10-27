import * as timerService from '../services/timer.service.js';

// Every response includes the server's clock so devices can correct their own clock differences
const serverTime = () => new Date().toISOString();

export const getTimer = async (req, res) => {
  const timer = await timerService.getRunning(req.user.id);
  res.json({ timer, serverTime: serverTime() });
};

export const startTimer = async (req, res) => {
  const timer = await timerService.start(req.user.id, req.body);
  res.status(201).json({ timer, serverTime: serverTime() });
};

export const stopTimer = async (req, res) => {
  const entry = await timerService.stop(req.user.id);
  res.json({ entry, serverTime: serverTime() });
};

export const updateTimer = async (req, res) => {
  const timer = await timerService.updateRunning(req.user.id, req.body);
  res.json({ timer, serverTime: serverTime() });
};
