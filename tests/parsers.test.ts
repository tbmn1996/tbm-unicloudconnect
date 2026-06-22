import assert from 'node:assert/strict';
import test from 'node:test';

import { extractSemester, parseCourses } from '../src/learnweb-core/parsers/courses';
import { parseFolderHtml } from '../src/learnweb-core/parsers/folder';
import { parseCourseOverview } from '../src/learnweb-core/parsers/overview';
import { parseResourceResponse } from '../src/learnweb-core/parsers/resource';

const BASE_URL = 'https://learnweb.example/moodle';

test('Kursparser dedupliziert Dashboard-Links', () => {
  const html = `
    <a href="/moodle/course/view.php?id=7" title="Softwaretechnik">Kurs</a>
    <a href="/moodle/course/view.php?id=7">Duplikat</a>
    <a href="/moodle/course/view.php?id=9">Datenbanken</a>`;
  const courses = parseCourses(html, BASE_URL);
  assert.deepEqual(courses.map((course) => course.courseId), [7, 9]);
  assert.equal(courses[0]?.name, 'Softwaretechnik');
});

test('Kursparser bevorzugt vollständige Namen und erkennt das Semester', () => {
  const html = `
    <a href="/moodle/course/view.php?id=7" title="Einführung in die Psychologie, Diagn...">Kurz</a>
    <a href="/moodle/course/view.php?id=7">Einführung in die Psychologie WiSe 2025/26, Diagnose</a>`;
  const courses = parseCourses(html, BASE_URL);
  assert.equal(courses[0]?.name, 'Einführung in die Psychologie WiSe 2025/26, Diagnose');
  assert.equal(courses[0]?.semester, 'WiSe 2025/26');
  assert.equal(extractSemester('Kurs im Sommersemester 2026'), 'SoSe 2026');
  assert.equal(extractSemester('Kurs ohne Zeitangabe'), null);
});

test('Kursparser nutzt die Kursnavigation und ignoriert Townsquare-Störlinks', () => {
  const html = `
    <div class="townsquare">
      <a href="/moodle/course/view.php?id=99">hier</a>
      <a href="/moodle/course/view.php?id=98">https://learnweb.example/course/view.php?id=98</a>
    </div>
    <ul>
      <li class="sub-sub-menu-item">
        <a href="/moodle/course/view.php?id=7" title="Informatik II WiSe 2025/26">Kurs öffnen</a>
      </li>
      <li class="sub-sub-menu-item">
        <a href="/moodle/course/view.php?id=9">Datenbanken</a>
      </li>
    </ul>`;

  const courses = parseCourses(html, BASE_URL);

  assert.deepEqual(courses.map((course) => course.courseId), [7, 9]);
  assert.equal(courses[0]?.name, 'Informatik II WiSe 2025/26');
});

test('Kursparser-Fallback filtert unplausible Linktexte', () => {
  const html = `
    <a href="/moodle/course/view.php?id=7">Informatik II</a>
    <a href="/moodle/course/view.php?id=8">hier</a>
    <a href="/moodle/course/view.php?id=9">de</a>`;

  assert.deepEqual(parseCourses(html, BASE_URL).map((course) => course.courseId), [7]);
});

test('Kursübersicht erkennt Sections und überspringt Labels', () => {
  const html = `
    <h1>Testkurs</h1>
    <li class="course-section" data-sectionname="Woche 1">
      <ul data-for="cmlist">
        <li data-for="cmitem" data-id="11" class="activity modtype_resource">
          <div data-activityname="Skript 1"></div><a class="aalink" href="/mod/resource/view.php?id=11"></a>
        </li>
        <li data-for="cmitem" data-id="12" class="activity modtype_label"></li>
      </ul>
    </li>`;
  const overview = parseCourseOverview(html, 7, BASE_URL);
  assert.equal(overview.sections[0]?.activities.length, 1);
  assert.equal(overview.sections[0]?.activities[0]?.cmid, 11);
});

test('Ressourcen und Ordner liefern normalisierte Downloadziele', () => {
  const resource = parseResourceResponse({
    status: 200,
    url: `${BASE_URL}/mod/resource/view.php?id=11`,
    headers: {},
    data: '<h1>Skript</h1><a href="/pluginfile.php/1/test/skript.pdf">Download</a>',
  }, 11, BASE_URL);
  assert.equal(resource.filename, 'skript.pdf');
  assert.match(resource.downloadUrl ?? '', /pluginfile\.php/);

  const folder = parseFolderHtml(
    '<h1>Material</h1><a href="/pluginfile.php/a.pdf"><span class="fp-filename">A.pdf</span></a>',
    12,
    BASE_URL,
  );
  assert.deepEqual(folder.entries.map((entry) => entry.name), ['A.pdf']);
});
