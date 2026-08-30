module.exports = function calculateCosts(jobs) {
  let totalCost = 0;

  const analyzedJobs =
    jobs.map((job) => {
      const duration =
        Number(
          job.durationMinutes || 0
        );

      const runs =
        Number(job.runs || 0);

      let rate = 0.008;

      if (
        job.runner?.includes("windows")
      ) {
        rate = 0.016;
      }

      if (
        job.runner?.includes("macos")
      ) {
        rate = 0.08;
      }

      const estimatedCost =
        duration *
        runs *
        rate;

      totalCost += estimatedCost;

      return {
        ...job,

        estimatedCost:
          Number(
            estimatedCost.toFixed(4)
          ),
      };
    });

  return {
    jobs: analyzedJobs,

    totalCost:
      Number(totalCost.toFixed(2)),
  };
}