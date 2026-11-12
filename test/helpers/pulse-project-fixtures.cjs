'use strict';

const { PROJECTS } = require('../../lib/pulse-project-catalog');
const now = Date.parse('2026-11-13T12:00:00Z');

async function publication(url) {
  const events = Object.values(PROJECTS).flat().flatMap(project => project.developments)
    .filter(event => url === event.url + (event.discourseAuthor ? '.json' : ''));
  if (!events.length) throw Error('Unexpected source request');
  const [event] = events;
  const claims = events.map(item => `<p>${item.marker}</p>`).join('');
  if (event.discourseAuthor) {
    return Response.json({ title: event.title, post_stream: { posts: [
      { post_number: 1, username: event.discourseAuthor, created_at: event.date + 'T12:00:00Z', cooked: claims },
    ] } });
  }
  return new Response(`<html><head><title>${event.title}</title></head><body><h1>${event.title}</h1><time>${event.date}</time>${claims}</body></html>`);
}

module.exports = { now, publication };
