// Every file in this folder is a transmission: it joins the feed on
// /transmissions/ and also gets a page of its own. The filename's leading date
// is what sorts the folder in an editor — it's stripped out of the URL, which
// is just the slug.
const slugOf = (fileSlug) => fileSlug.replace(/^\d{4}-\d{2}-\d{2}-/, "");

module.exports = {
  tags: "transmissions",
  layout: "_layouts/transmission.njk",
  permalink: (data) => `/transmissions/${slugOf(data.page.fileSlug)}/`,
  eleventyComputed: {
    // the titlebar and <title> read "sp3ctr-zone :: transmissions/<slug>", so a
    // single entry still announces which part of the node you're standing in.
    section: (data) => `transmissions/${slugOf(data.page.fileSlug)}`,
    description: (data) => `${data.title} — a transmission from sp3ctr-zone.`,
  },
};
