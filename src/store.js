// Tiny JSON-file storage for connected accounts and upload history.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.paths.data, { recursive: true });
fs.mkdirSync(config.paths.uploads, { recursive: true });

const accountsFile = path.join(config.paths.data, 'accounts.json');
const jobsFile = path.join(config.paths.data, 'jobs.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

// ---------- accounts ----------
let accounts = readJson(accountsFile, {});

export function getAccounts() {
  return accounts;
}

export function updateAccounts(patch) {
  accounts = { ...accounts, ...patch };
  writeJson(accountsFile, accounts);
  return accounts;
}

export function removeAccount(key) {
  delete accounts[key];
  writeJson(accountsFile, accounts);
}

// ---------- jobs ----------
const MAX_JOBS = 100;
let jobs = readJson(jobsFile, []);

// Anything still "running" when the server restarted can never finish.
for (const job of jobs) {
  for (const p of Object.values(job.platforms)) {
    if (p.state === 'pending' || p.state === 'running') {
      p.state = 'error';
      p.message = 'Server restarted during upload';
    }
  }
}

function saveJobs() {
  writeJson(jobsFile, jobs.slice(0, MAX_JOBS));
}

export function createJob(job) {
  jobs.unshift(job);
  jobs = jobs.slice(0, MAX_JOBS);
  saveJobs();
  return job;
}

export function getJob(id) {
  return jobs.find((j) => j.id === id);
}

export function listJobs() {
  return jobs;
}

export function updatePlatform(jobId, platform, patch) {
  const job = getJob(jobId);
  if (!job) return;
  job.platforms[platform] = { ...job.platforms[platform], ...patch, updatedAt: new Date().toISOString() };
  saveJobs();
}
