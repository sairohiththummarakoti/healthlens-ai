import config from './playwright.config';
export default {
  ...config,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { ...config.use, baseURL: 'http://127.0.0.1:5174' },
};
