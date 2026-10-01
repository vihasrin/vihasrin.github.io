'use strict';

const projects = {
  nasa: {
    eyebrow: '01 / NASA AMES · WEB APPLICATION',
    title: 'Making space technology accessible.',
    summary: 'A project translating a 450-page small-satellite technology report into an interactive web application.',
    detailTitle: 'My part in the project',
    detail: 'As Product Owner and a UI/UX contributor, I worked across stakeholder alignment, wireframes, user flows, and Agile planning to help the team turn complex information into a clearer experience.',
    tags: ['Product ownership', 'UI/UX', 'Stakeholder collaboration'],
    url: 'https://www.linkedin.com/in/vihasrinivas',
    linkLabel: 'Read the project recommendations'
  },
  robot: {
    eyebrow: '02 / CORNELL TECH · ROBOT ISLAND',
    title: 'Night Bus / Battery.',
    summary: 'A speculative autonomous-vehicle case study for Roosevelt Island, featured in Cornell Tech’s Robot Island collection.',
    detailTitle: 'An exploration of urban possibility',
    detail: 'The Robot Island showcase gathers Cornell Tech student concepts about autonomous vehicles and the future of the island. My concept, Night Bus / Battery, appears in the Passenger collection.',
    tags: ['Speculative design', 'Urban technology', 'Mobility'],
    url: 'https://robotisland.urbantech.info/',
    linkLabel: 'Visit the Robot Island showcase'
  },
  align: {
    eyebrow: '03 / ALIGN TECHNOLOGY · SUMMER 2026',
    title: 'A human side to healthcare.',
    summary: 'A summer Product Intern role at Align Technology, exploring products at the intersection of healthcare and technology.',
    detailTitle: 'The start of a new chapter',
    detail: 'I shared the news of this role on LinkedIn. Follow that story for the public announcement and the next steps in my product journey.',
    tags: ['Product', 'Healthcare technology', 'Internship'],
    url: 'https://www.linkedin.com/posts/vihasrinivas_productmanagement-aligntechnology-invisalign-activity-7440905910425653248-TwoS',
    linkLabel: 'Read the internship announcement'
  }
};

const dialog = document.getElementById('project-dialog');
let dialogTrigger = null;

if (typeof dialog.showModal === 'function') {
  document.querySelectorAll('[data-project]').forEach(link => {
    link.addEventListener('click', event => {
      // Preserve opening the source directly with modifier keys or the middle mouse button.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const project = projects[link.dataset.project];
      if (!project) return;
      event.preventDefault();
      dialogTrigger = link;
      document.getElementById('dialog-eyebrow').textContent = project.eyebrow;
      document.getElementById('dialog-title').textContent = project.title;
      document.getElementById('dialog-summary').textContent = project.summary;
      document.getElementById('dialog-detail-title').textContent = project.detailTitle;
      document.getElementById('dialog-detail-copy').textContent = project.detail;
      document.getElementById('dialog-tags').replaceChildren(...project.tags.map(tag => {
        const pill = document.createElement('span');
        pill.textContent = tag;
        return pill;
      }));
      const sourceLink = document.getElementById('dialog-link');
      sourceLink.href = project.url;
      sourceLink.replaceChildren(document.createTextNode(project.linkLabel + ' '));
      const arrow = document.createElement('span');
      arrow.textContent = '↗';
      arrow.setAttribute('aria-hidden', 'true');
      sourceLink.append(arrow);
      dialog.showModal();
      document.body.classList.add('dialog-open');
      dialog.querySelector('.dialog-close').focus();
    });
  });
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('dialog-open');
    dialogTrigger?.focus({ preventScroll: true });
  });
}

const filters = document.querySelector('.filters');
const projectCards = [...document.querySelectorAll('.project-card')];
filters.hidden = false;
filters.addEventListener('click', event => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  filters.querySelectorAll('button').forEach(filter => {
    const selected = filter === button;
    filter.classList.toggle('active', selected);
    filter.setAttribute('aria-pressed', String(selected));
  });
  let visibleCount = 0;
  projectCards.forEach(card => {
    const visible = button.dataset.filter === 'all' || card.dataset.category.split(' ').includes(button.dataset.filter);
    card.hidden = !visible;
    if (visible) visibleCount += 1;
  });
  document.getElementById('filter-status').textContent = `${visibleCount} work ${visibleCount === 1 ? 'item' : 'items'} shown.`;
});

const remixButton = document.getElementById('remix-board');
const board = document.getElementById('notebook-board');
const boardCards = [...board.children];
const boardOrders = [[0, 1, 2, 3], [2, 0, 3, 1], [1, 3, 0, 2], [3, 2, 1, 0]];
let remixIndex = 0;
remixButton.hidden = false;
remixButton.addEventListener('click', () => {
  remixIndex = (remixIndex + 1) % boardOrders.length;
  boardOrders[remixIndex].forEach(index => board.append(boardCards[index]));
  board.classList.toggle('remixed', remixIndex % 2 === 1);
  document.getElementById('board-status').textContent = 'The notebook board has been rearranged. A fresh perspective!';
});

const copyButton = document.getElementById('copy-email');
if (navigator.clipboard && window.isSecureContext) {
  copyButton.hidden = false;
  let statusTimer;
  copyButton.addEventListener('click', async () => {
    const status = document.getElementById('copy-status');
    clearTimeout(statusTimer);
    try {
      await navigator.clipboard.writeText('viha.srinivas@gmail.com');
      status.textContent = 'Email copied. Say hello anytime!';
    } catch {
      status.textContent = 'You can select the email address above to copy it.';
    }
    statusTimer = setTimeout(() => { status.textContent = ''; }, 5000);
  });
}

document.getElementById('year').textContent = new Date().getFullYear();
