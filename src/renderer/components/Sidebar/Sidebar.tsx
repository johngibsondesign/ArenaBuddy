import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHouse, faChessKnight } from '@fortawesome/free-solid-svg-icons';
import { NavLink } from 'react-router-dom';

export const Sidebar: React.FC = () => (
  <div className="flex h-screen w-16 flex-col justify-between bg-slate-900 text-gray-300 p-3 gap-2">
    <div>
      <div className="inline-flex  items-center justify-center">
        <span className="grid size-10 place-content-center rounded-lg bg-gradient-to-br from-sky-400 to-violet-600 text-xs font-semibold text-white">
          AB
        </span>
      </div>

        <div className="px-2 pt-4">
          <nav className="flex flex-col items-center gap-2">
            <NavLink
              to="/"
              end
              className={({ isActive }) => `group relative flex size-10 items-center justify-center rounded-md ${isActive ? 'bg-gradient-to-br from-sky-400 to-violet-600 text-white' : 'bg-highlight/15 text-highlight hover:bg-highlight/25'} transition`}
            >
              <FontAwesomeIcon icon={faHouse} className="text-lg" />
              <span className="invisible absolute start-full top-1/2 ms-3 -translate-y-1/2 rounded-sm bg-gray-900 px-2 py-1.5 text-xs font-medium text-white group-hover:visible">
                Home
              </span>
            </NavLink>
            <NavLink
              to="/champions"
              className={({ isActive }) => `group relative flex size-10 items-center justify-center rounded-md ${isActive ? 'bg-gradient-to-br from-sky-400 to-violet-600 text-white' : 'bg-highlight/15 text-highlight hover:bg-highlight/25'} transition`}
            >
              <FontAwesomeIcon icon={faChessKnight} className="text-lg" />
              <span className="invisible absolute start-full top-1/2 ms-3 -translate-y-1/2 rounded-sm bg-gray-900 px-2 py-1.5 text-xs font-medium text-white group-hover:visible">
                Champions
              </span>
            </NavLink>
          </nav>
        </div>
      </div>

  </div>
);
