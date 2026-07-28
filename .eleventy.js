module.exports = function (eleventyConfig) {
  // css/ and js/ stay exactly where they were before Eleventy — just copied
  // straight into the build output, untouched.
  eleventyConfig.addPassthroughCopy("css");
  eleventyConfig.addPassthroughCopy("js");
  eleventyConfig.addPassthroughCopy("favicon.svg");
  eleventyConfig.addPassthroughCopy("favicon.ico");

  // Frontmatter dates parse as UTC midnight, so format with UTC getters —
  // using local getters here would roll the date back a day in some timezones.
  eleventyConfig.addFilter("dateDisplay", (date) => {
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
  });

  return {
    dir: {
      input: "src",
      output: "_site",
    },
  };
};
