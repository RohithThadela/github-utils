import autoParse from 'auto-parse';
import dotenv from 'dotenv-extended';
import getUnixTime from 'date-fns/fp/getUnixTime';
import fromUnixTime from 'date-fns/fp/fromUnixTime';
import subDays from 'date-fns/fp/subDays';
import isWeekend from 'date-fns/fp/isWeekend';
import fs from 'fs/promises';
import git from 'simple-git';
import { getRandomInt } from './random';

// Load environment variables
const env = autoParse({
  GIT_BRANCH: process.env.GIT_BRANCH || process.env.GITHUB_REF?.replace(/^refs\/heads\//, ''),
  ORIGIN_TIMESTAMP: process.env.ORIGIN_TIMESTAMP || getUnixTime(new Date()),
  ...dotenv.load({ errorOnMissing: true, includeProcessEnv: true }),
});

// Read inputs
const backfill = process.env.BACKFILL === 'true'; // Add commits for past dates
const skipWeekends = process.env.SKIP_WEEKENDS === 'true'; // Skip commits on weekends

const localPath = './clone';
const repoPath = `https://${env.GITHUB_ACTOR}:${env.GITHUB_TOKEN}@${env.GIT_HOST}/${env.GITHUB_REPOSITORY}`;
const secondLine = 'Committed via https://github.com/marketplace/actions/autopopulate-your-contribution-graph';

// Define the start date (September 13, 2024)
const startDate = new Date('2024-09-13'); // Replace with your desired start date
const today = new Date();

// Calculate the number of days between the start date and today
const timeDiff = today.getTime() - startDate.getTime();
const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24)); // Convert milliseconds to days

// Generate an array of day offsets
const dayOffsets = [...Array(daysDiff).keys()];

await fs.mkdir(localPath);

if (env.FORCE_PUSH) {
  await git(localPath).init();
} else {
  await git().clone(repoPath, localPath, ['--single-branch', '-b', env.GIT_BRANCH]);
}

await git(localPath).env({ GIT_SSH_COMMAND: env.GIT_SSH_COMMAND });
await git(localPath).addConfig('user.name', env.GITHUB_ACTOR);
await git(localPath).addConfig('user.email', env.GIT_EMAIL);

await dayOffsets
  .map((dayOffset) => subDays(dayOffset, today)) // Generate dates from today backwards
  .filter((day) => !(skipWeekends && isWeekend(day))) // Skip weekends if enabled
  .map((/** @type {Date} */ day) => {
    const commitsToMake = getRandomInt(env.MIN_COMMITS_PER_DAY, env.MAX_COMMITS_PER_DAY);
    return [...Array(commitsToMake)].map((_, i) => async () => {
      const { commit: sha } = await git(localPath).commit([env.GIT_COMMIT_MESSAGE, secondLine], {
        '--allow-empty': null,
        '--date': `format:iso8601:${day.toISOString()}`,
      });
      console.log(`Successfully committed ${sha} on ${day.toISOString()} (${i + 1} / ${commitsToMake})`);
    });
  })
  .flat()
  .reduce((commitPromises, nextPromise) => commitPromises.then(nextPromise), Promise.resolve());

await git(localPath).push(repoPath, `HEAD:${env.GIT_BRANCH}`, env.FORCE_PUSH && { '--force': null });
