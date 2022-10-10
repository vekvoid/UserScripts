// ==UserScript==
// @name        Twitch Pinned Streamers - twitch.tv
// @description Pin Twitch streamers on sidebar without being logged in.
// @namespace   https://github.com/vekvoid/UserScripts
// @homepageURL https://github.com/vekvoid/UserScripts/
// @supportURL  https://github.com/vekvoid/UserScripts/issues
// @match        *://*.twitch.tv/*
// @grant       none
// @version     1.0.0
// ==/UserScript==

const logLevels = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60,
};

const NAME = 'Twitch Pinned Streamers';
const CURRENT_LOG_LEVEL = logLevels.debug;
const DETECT_PAGE_CHANGE_INTERVAL = 1000;
const ALL_RELEVANT_CONTENT_SELECTOR = '.hVqkZv';
const TWITCH_GRAPHQL = 'https://gql.twitch.tv/gql';
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // From Alternate Player for Twitch.tv

const logger = {
  /* eslint-disable no-console */
  trace: (...args) => (logLevels.trace >= CURRENT_LOG_LEVEL) && console.trace(`${NAME}:`, ...args),
  debug: (...args) => (logLevels.debug >= CURRENT_LOG_LEVEL) && console.log(`${NAME}:`, ...args),
  info: (...args) => (logLevels.info >= CURRENT_LOG_LEVEL) && console.info(`${NAME}:`, ...args),
  warn: (...args) => (logLevels.warn >= CURRENT_LOG_LEVEL) && console.warn(`${NAME}:`, ...args),
  error: (...args) => (logLevels.error >= CURRENT_LOG_LEVEL) && console.error(`${NAME}:`, ...args),
  fatal: (...args) => (logLevels.fatal >= CURRENT_LOG_LEVEL) && console.fatal(`${NAME}:`, ...args),
  /* eslint-enable no-console */
};

const css = `
  .tps-pinned-container {
    min-height: 0;
    overflow: hidden;
    transition: all 250ms ease 0ms;
  }

  .dpqRKW .tps-remove-pinned-streamer {
    opacity: 0;
  }

  .dpqRKW:hover .tps-remove-pinned-streamer {
    opacity: 0.5;
  }

  .tps-remove-pinned-streamer {
    transition: all 150ms ease 0ms;
    opacity: 0.5;
  }

  .tps-remove-pinned-streamer:hover {
    opacity: 1 !important;
  }
`;

let currentPage = window.top.location.href;
let previousPage = '';
let isWorking = false;

(() => {
  logger.info('Started');

  setInterval(() => {
    [currentPage] = window.top.location.href.split('#');

    if (currentPage === previousPage) {
      return;
    }

    previousPage = currentPage;

    main();
  }, DETECT_PAGE_CHANGE_INTERVAL);
})();

let waitForMainContainer;

const main = () => {
  let relevantContent;

  if (waitForMainContainer) {
    clearInterval(waitForMainContainer);
  }

  waitForMainContainer = setInterval(() => {
    relevantContent = document.querySelector(ALL_RELEVANT_CONTENT_SELECTOR);

    if (!relevantContent) {
      return;
    }

    if (relevantContent.childElementCount < 2) {
      return;
    }

    clearInterval(waitForMainContainer);

    logger.debug('Main content found.');

    injectCSS();

    const observer = new MutationObserver(async () => {
      if (isWorking) {
        return;
      }
      isWorking = true;
      if (document.getElementById('anon-followed')) {
        return;
      }

      const sidebar = relevantContent.querySelector('.side-nav.side-nav--expanded .Layout-sc-nxg1ff-0.SVxtW');
      logger.debug(sidebar);
      if (!sidebar) {
        return;
      }

      const sidebarContent = sidebar.querySelector(
        '.InjectLayout-sc-588ddc-0 .simplebar-content .side-bar-contents nav div > div > div',
      );

      const anonFollowedElement = document.createElement('div');
      anonFollowedElement.id = 'anon-followed';

      anonFollowedElement.innerHTML += pinnedHeader();
      anonFollowedElement.innerHTML += '<div class="tps-pinned-container"></div>';
      sidebarContent.insertBefore(anonFollowedElement, sidebarContent.childNodes[0]);

      await renderPinnedStreamers();

      document.getElementById('tps-add-streamer').onclick = addStreamer;

      const mainSection = relevantContent.querySelector('main');

      logger.debug(sidebar, mainSection);
      isWorking = false;
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }, 500);
};

const injectCSS = () => {
  const style = document.createElement('style');
  document.head.appendChild(style);
  style.appendChild(document.createTextNode(css));
};

const addStreamer = async () => {
  // eslint-disable-next-line no-alert
  const streamerUser = prompt('Streamer username:');
  if (!streamerUser) {
    return;
  }

  const pinned = localStorageGetPinned();

  const found = pinned.find((user) => user.user.toLowerCase() === streamerUser.toLowerCase());
  if (found) {
    logger.info(`Streamer '${streamerUser}' already pinned.`);
    return;
  }

  const user = await getTwitchUser(streamerUser);
  logger.debug(user);
  if (!user.id) {
    const message = `Streamer '${streamerUser}' not found.`;
    logger.warn(message);
    // eslint-disable-next-line no-alert
    alert(message);
    return;
  }

  pinned.push(user);

  localStorageSetPinned(pinned);
  logger.debug(localStorage['tps:pinned']);

  const prevHeight = document.querySelector('.tps-pinned-container').getBoundingClientRect().height;
  const nextHeight = prevHeight + document.querySelector('.tps-pinned-container > div').getBoundingClientRect().height;
  document.querySelector('.tps-pinned-container').style.height = `${prevHeight}px`;

  await renderPinnedStreamers();

  document.querySelector('.tps-pinned-container').style.height = `${nextHeight}px`;
  setTimeout(() => { document.querySelector('.tps-pinned-container').style.height = ''; }, 500);
};

const removeStreamer = async (id) => {
  const filtered = localStorageGetPinned().filter((p) => p.id !== id && p.id);
  localStorageSetPinned(filtered);

  const prevHeight = document.querySelector('.tps-pinned-container').getBoundingClientRect().height;
  const nextHeight = prevHeight - document.querySelector('.tps-pinned-container > div').getBoundingClientRect().height;
  document.querySelector('.tps-pinned-container').style.height = `${prevHeight}px`;

  await renderPinnedStreamers();

  document.querySelector('.tps-pinned-container').style.height = `${nextHeight}px`;
  setTimeout(() => { document.querySelector('.tps-pinned-container').style.height = ''; }, 500);
};

const renderPinnedStreamers = async () => {
  const promises = localStorageGetPinned().map(async (streamer) => {
    const streamerInfo = await getTwitchStreamInfo(streamer.id);

    return {
      ...streamer, ...streamerInfo,
    };
  });
  const pinnedStreamers = await Promise.all(promises);

  document.getElementById('anon-followed').querySelector('div:nth-child(2)').innerHTML = '';

  pinnedStreamers
    .sort((a, b) => ((a.viewers < b.viewers) ? 1 : -1))
    .sort((a, b) => {
      if (a.isLive === b.isLive) return 0;
      return a.isLive ? -1 : 1;
    })
    .forEach((data) => {
      document.getElementById('anon-followed').querySelector('div:nth-child(2)').innerHTML += pinnedStreamer({
        ...data,
      });
    });

  document.querySelectorAll('.tps-remove-pinned-streamer').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      const id = event.target.getAttribute('data-id');
      logger.debug(`Removing pinned streamer with id: ${id}`);
      await removeStreamer(id);
      logger.debug(`Removed pinned streamer with id: ${id}`);
    });
  });
};

// HTML templates

const pinnedHeader = () => `
<div class="Layout-sc-nxg1ff-0 hbYWXo side-nav-header" data-a-target="side-nav-header-expanded">
  <h2 style="display:inline-block;" class="CoreText-sc-cpl358-0 ezafKb">Pinned Channels</h2>
  ${addBtn()}
</div>`;

const addBtn = () => `
<button id="tps-add-streamer" title="Add Pinned Streamer" style="width:20px;height:16px;" class="ScCoreButton-sc-1qn4ixc-0 ffyxRu ScButtonIcon-sc-o7ndmn-0 nHKTN" data-test-selector="side-nav__visibility-toggle" aria-label="Add Pinned Streamer" data-a-target="side-nav-arrow" aria-describedby="899ca5e6b29344b30e076163389e61c5">
  <div class="ButtonIconFigure-sc-1ttmz5m-0 fbCCvx">
    <div class="ScIconLayout-sc-1bgeryd-0 cXxJjc">
      <div class="ScAspectRatio-sc-1sw3lwy-1 kPofwJ tw-aspect">
        <div class="ScAspectSpacer-sc-1sw3lwy-0 dsswUS"></div><svg width="100%" height="100%" version="1.1" viewBox="0 0 25 25" x="0px" y="0px" class="ScIconSVG-sc-1bgeryd-1 ifdSJl">
          <g>
            <path vector-effect="non-scaling-stroke" d="M 12 2 C 6.4889971 2 2 6.4889971 2 12 C 2 17.511003 6.4889971 22 12 22 C 17.511003 22 22 17.511003 22 12 C 22 6.4889971 17.511003 2 12 2 z M 12 4 C 16.430123 4 20 7.5698774 20 12 C 20 16.430123 16.430123 20 12 20 C 7.5698774 20 4 16.430123 4 12 C 4 7.5698774 7.5698774 4 12 4 z M 11 7 L 11 11 L 7 11 L 7 13 L 11 13 L 11 17 L 13 17 L 13 13 L 17 13 L 17 11 L 13 11 L 13 7 L 11 7 z"></path>
          </g>
        </svg>
      </div>
    </div>
  </div>
</button>`;

const pinnedStreamer = ({
  user, id, displayName, profileImageURL, isLive, viewers = '', category,
}) => {
  const removeBtn = `<button class="tps-remove-pinned-streamer" data-id="${id}" title="Remove pinned streamer" style="position:absolute;top:-6px;left:2px;z-index:1;">x</button>`;
  const prettyViewers = stylizedViewers(viewers);

  return `
<div style="transition-property: transform, opacity; transition-timing-function: ease;" class="ScTransitionBase-sc-eg1bd7-0 dpqRKW tw-transition">
  <div>
    ${removeBtn}
    <div style="${!isLive ? 'opacity:0.4;' : ''}" class="Layout-sc-nxg1ff-0 fcPbos side-nav-card" data-test-selector="side-nav-card"><a data-a-id="recommended-channel-0" data-test-selector="recommended-channel" class="ScCoreLink-sc-udwpw5-0 cmQKL InjectLayout-sc-588ddc-0 hqHHYw side-nav-card__link tw-link" href="/${user}">
        <div class="Layout-sc-nxg1ff-0 kZFVrV side-nav-card__avatar">
          <figure aria-label="${displayName}" class="ScAvatar-sc-12nlgut-0 dncwPH tw-avatar"><img class="InjectLayout-sc-588ddc-0 iDjrEF tw-image tw-image-avatar" alt="${displayName}" src="${profileImageURL}"></figure>
        </div>
        <div class="Layout-sc-nxg1ff-0 blhocS">
          <div data-a-target="side-nav-card-metadata" class="Layout-sc-nxg1ff-0 bGPqDX">
            <div class="Layout-sc-nxg1ff-0 gcwIMz side-nav-card__title">
              <p title="${displayName}" data-a-target="side-nav-title" class="CoreText-sc-cpl358-0 gYupEs InjectLayout-sc-588ddc-0 emHXNr">${displayName}</p>
            </div>
            <div class="Layout-sc-nxg1ff-0 bXhxYI side-nav-card__metadata" data-a-target="side-nav-game-title">
              <p title="${isLive ? category : ''}" class="CoreText-sc-cpl358-0 ciPVTQ">${isLive ? category : ''}</p>
            </div>
          </div>
          <div class="Layout-sc-nxg1ff-0 iiA-dIp side-nav-card__live-status" data-a-target="side-nav-live-status">
            <div class="Layout-sc-nxg1ff-0 gcwIMz">
              ${isLive ? '<div class="ScChannelStatusIndicator-sc-1cf6j56-0 dtUsEc tw-channel-status-indicator" data-test-selector="0" aria-label="Live"></div>' : ''}
              <div class="Layout-sc-nxg1ff-0 gtLBqE"><span data-test-selector="1" aria-label="${prettyViewers} viewers" class="CoreText-sc-cpl358-0 iUznyJ">${prettyViewers}</span></div>
            </div>
          </div>
        </div>
      </a></div>
  </div>
</div>
  `;
};

const stylizedViewers = (viewers) => {
  if (!viewers) {
    return '';
  }

  const number = parseInt(viewers, 10);
  return nFormatter(number, 1);
};

// From https://stackoverflow.com/a/9462382
function nFormatter(num, digits) {
  const lookup = [
    { value: 1, symbol: '' },
    { value: 1e3, symbol: 'K' },
    { value: 1e6, symbol: 'M' },
    { value: 1e9, symbol: 'G' },
    { value: 1e12, symbol: 'T' },
    { value: 1e15, symbol: 'P' },
    { value: 1e18, symbol: 'E' },
  ];
  const rx = /\.0+$|(\.[0-9]*[1-9])0+$/;
  const item = lookup.slice().reverse().find((lookupItem) => num >= lookupItem.value);
  return item ? (num / item.value).toFixed(digits).replace(rx, '$1') + item.symbol : '0';
}

// GRAPHQL Requests

const getTwitchUser = async (login) => {
  const twitchUser = await twitchGQLRequest({
    query: `query($login: String!, $skip: Boolean!) {
      user(login: $login) {
        broadcastSettings {
          language
        }
        createdAt
        description
        displayName
        followers {
          totalCount
        }
        id
        lastBroadcast {
            startedAt
        }
        primaryTeam {
          displayName
          name
        }
        profileImageURL(width: 70)
        profileViewCount
        self @skip(if: $skip) {
          canFollow
          follower {
            disableNotifications
          }
        }
      }
    }`,
    variables: { login, skip: false },
  });

  return {
    user: login,
    id: twitchUser?.data?.user?.id,
    displayName: twitchUser?.data?.user?.displayName,
    profileImageURL: twitchUser?.data?.user?.profileImageURL,
  };
};

const getTwitchStreamInfo = async (userId) => {
  const twitchUserStreamInfo = await twitchGQLRequest({
    query: `query($id: ID!, $all: Boolean!) {
      user(id: $id) {
        broadcastSettings {
          game {
            displayName
            name
          }
          title
        }
        login
        stream {
          archiveVideo @include(if: $all) {
              id
          }
          createdAt
          id
          type
          viewersCount
        }
      }
    }
    `,
    variables: { id: userId, all: false },
  });

  return {
    isLive: twitchUserStreamInfo?.data?.user?.stream?.type,
    viewers: twitchUserStreamInfo?.data?.user?.stream?.viewersCount,
    category: twitchUserStreamInfo?.data?.user?.broadcastSettings?.game?.displayName,
    title: twitchUserStreamInfo?.data?.user?.broadcastSettings?.title,
  };
};

const twitchGQLRequest = async ({ query, variables }) => {
  const headers = new Headers();
  headers.append('Client-ID', CLIENT_ID);
  headers.append('Content-Type', 'application/json');

  const graphql = JSON.stringify({
    query,
    variables,
  });
  const requestOptions = {
    method: 'POST',
    headers,
    body: graphql,
    redirect: 'follow',
  };

  return fetch(TWITCH_GRAPHQL, requestOptions)
    .then((response) => {
      if (!response.ok) {
        logger.warn('GraphQL request error:', query, variables);
        throw new Error(`HTTP-Error twitchGQLRequest. Status code: ${response.status}`);
      }

      return response;
    })
    .then((response) => response.text())
    .then((text) => JSON.parse(text))
    .catch((error) => {
      throw error;
    });
};

// LocalStorage

const localStorageGetPinned = () => {
  const lsPinned = localStorage.getItem('tps:pinned');
  return lsPinned ? JSON.parse(lsPinned) : [];
};

const localStorageSetPinned = (data) => {
  localStorage.setItem('tps:pinned', JSON.stringify(data));
  return true;
};
