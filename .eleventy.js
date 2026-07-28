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

  // A transmission's opening paragraph doubles as its preview in the log, so
  // the index never restates copy that already lives in the entry itself. This
  // runs on rendered markdown, hence unpicking the tags and entities markdown-it
  // put in; the newlines collapse because a preview is always one line.
  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

  eleventyConfig.addFilter("firstParagraph", (content) => {
    const html = String(content ?? "");
    const paragraph = html.match(/<p>([\s\S]*?)<\/p>/i);

    return (paragraph ? paragraph[1] : html)
      .replace(/<[^>]+>/g, "")
      .replace(/&(#?\w+);/g, (entity, name) => ENTITIES[name] ?? entity)
      .replace(/\s+/g, " ")
      .trim();
  });

  return {
    dir: {
      input: "src",
      output: "_site",
    },
  };
};
