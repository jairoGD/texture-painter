import { button, element } from './index.js';
import './project-home.css';

export function createProjectHome({ onNew, onOpen, onRecent, onRemoveRecent }) {
  const recentList = element('div', { className: 'project-home__recent-list' });
  const message = element('p', { className: 'project-home__message', attributes: { role: 'status' } });
  const close = button({ label: 'Back to editor', variant: 'ghost', onClick: hide });
  close.classList.add('project-home__close');
  const root = element('div', { className: 'project-home' }, [
    element('div', { className: 'project-home__card' }, [
      element('div', { className: 'project-home__top' }, [
        element('h1', { text: 'TEXTURE PAINTER' }),
        close
      ]),
      element('div', { className: 'project-home__choices' }, [
        button({ label: 'New Project', variant: 'primary', onClick: () => onNew('Untitled Project') }),
        button({ label: 'Open Project', onClick: onOpen })
      ]),
      element('div', { className: 'project-home__recent-head' }, [
        element('h2', { text: 'Recent Projects' })
      ]),
      recentList,
      message
    ])
  ]);

  function setRecents(records) {
    if (!records.length) {
      recentList.replaceChildren(element('p', { className: 'project-home__empty',
        text: 'No recent projects' }));
      return;
    }
    recentList.replaceChildren(...records.map((record) => {
      const date = new Date(record.updatedAt);
      const control = button({ label: record.name, variant: 'ghost', onClick: () => onRecent(record) });
      control.classList.add('project-home__recent');
      control.append(element('span', { className: 'project-home__recent-date',
        text: Number.isNaN(date.getTime()) ? '' : date.toLocaleString() }));
      const remove = button({ label: `Remove ${record.name} from recent projects`, icon: '×',
        variant: 'ghost', iconOnly: true, onClick: () => onRemoveRecent(record.id) });
      return element('div', { className: 'project-home__recent-row' }, [control, remove]);
    }));
  }

  function show(canClose = false) {
    close.hidden = !canClose;
    root.hidden = false;
    message.textContent = '';
  }
  function hide() { root.hidden = true; }
  function setMessage(text) { message.textContent = text; }
  show(false);
  return { element: root, show, hide, setRecents, setMessage };
}
