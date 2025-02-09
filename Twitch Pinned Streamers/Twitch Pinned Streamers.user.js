// ==UserScript==
// @name        Twitch Pinned Streamers - twitch.tv
// @description Pin Twitch streamers on sidebar without being logged in.
// @namespace   https://github.com/vekvoid/UserScripts
// @homepageURL https://github.com/vekvoid/UserScripts/
// @supportURL  https://github.com/vekvoid/UserScripts/issues
// @match        *://*.twitch.tv/*
// @grant       none
// @icon https://www.google.com/s2/favicons?domain=twitch.com
// @version     1.3.0
// @downloadURL https://update.greasyfork.org/scripts/452717/Twitch%20Pinned%20Streamers%20-%20twitchtv.user.js
// @updateURL https://update.greasyfork.org/scripts/452717/Twitch%20Pinned%20Streamers%20-%20twitchtv.meta.js
// ==/UserScript==

const logLevels = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60,
};

const NAME = 'Twitch Pinned Streamers';
const CURRENT_LOG_LEVEL = logLevels.info;
const DETECT_PAGE_CHANGE_INTERVAL = 1000;
const MINUTES_SINCE_FOCUS_LOST_FOR_REFRESH = 1;
const REFRESH_DISPLAYED_DATA_DELAY_MINUTES = 5;

const ALL_RELEVANT_CONTENT_SELECTOR = '.dShujj';
const HEADER_CLONE_SELECTOR = ".side-nav-header[data-a-target='side-nav-header-expanded']";
const BTN_CLONE_SELECTOR = ".side-nav.side-nav--expanded[data-a-target='side-nav-bar']";
const BTN_INNER_CLONE_SELECTOR = ".simplebar-content button[data-a-target='side-nav-arrow']";
const NAV_CARD_CLONE_SELECTOR = ".side-nav-section .side-nav-card";

const FOLLOW_BUTTON_CONTAINER_CLONE_SELECTOR = '#live-channel-stream-information div[data-target="channel-header-right"] div:first-child';

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

   .tps-pinned-container div .tps-remove-pinned-streamer {
    opacity: 0;
  }

  .tps-pinned-container div :hover .tps-remove-pinned-streamer {
    opacity: 0.3;
  }

  .tps-remove-pinned-streamer {
    transition: all 150ms ease 0ms;
    opacity: 0.3;
  }

  .tps-remove-pinned-streamer:hover {
    opacity: 1 !important;
  }

  #tps-pin-current-streamer-button[data-a-target="pin-button"]:hover {
    background-color: var(--color-background-button-primary-hover) !important;
  }

  #tps-pin-current-streamer-button[data-a-target="unpin-button"]:hover {
    background-color: var(--color-background-button-secondary-hover) !important;
  }
`;

let currentPage = "window.top.location.href";
let previousPage = '';
let isWorking = false;
let isWorkingPinCurrentStreamer = false;

let isTabVisible = false;

let waitForMainContainer;

const main = () => {
  let relevantContent;

  if (waitForMainContainer) {
    clearInterval(waitForMainContainer);
  }

  waitForMainContainer = setInterval(async () => {
    relevantContent = document.querySelector(ALL_RELEVANT_CONTENT_SELECTOR);

    if (!relevantContent) {
      return;
    }

    if (relevantContent.childElementCount < 2) {
      return;
    }

    if (!relevantContent.querySelector(HEADER_CLONE_SELECTOR)) {
      return;
    }

    if (!relevantContent.querySelector(`${BTN_CLONE_SELECTOR} ${BTN_INNER_CLONE_SELECTOR}`)) {
      return;
    }

    clearInterval(waitForMainContainer);

    logger.debug('Main content found.');

    // Tab visibility handler

    isTabVisible = !document.hidden;
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) {
        logger.debug('Tab hidden.');
        isTabVisible = false;
        return;
      }


      logger.debug('Tab visible.');
      isTabVisible = true;

      // Refresh if change to visible
      const lastRefreshedAt = localStorageGetPinnedRefreshedAt();

      if (requireDataRefresh(lastRefreshedAt)) {
        logger.info("Refreshing pinned streamers.");

        try {
          await refreshPinnedData();
          await renderPinnedStreamers();
        } catch (error) {
          logger.warn(`Could not refresh pinned streamers. ${error?.message}`);
        }
      }
    });

    // End Tab visibility handler

    injectCSS();

    // Menu

    const observer = new MutationObserver(async () => {
      if (isWorking) {
        return;
      }

      if (document.getElementById('anon-followed')) {
        return;
      }

      const sidebar = relevantContent.querySelector(`.side-nav.side-nav--expanded`);
      logger.debug(sidebar);
      if (!sidebar) {
        return;
      }

      if (!sidebar.querySelector(`${NAV_CARD_CLONE_SELECTOR}:has(.side-nav-card__avatar)`)) {
        return;
      }

      isWorking = true;

      // '.simplebar-content .side-bar-contents nav div > div > div'
      const sidebarContent = sidebar.querySelector(
        '#side-nav div > div',
      );

      const anonFollowedElement = document.createElement('div');
      anonFollowedElement.id = 'anon-followed';

      anonFollowedElement.innerHTML += pinnedHeader();
      anonFollowedElement.innerHTML += '<div class="tps-pinned-container"></div>';
      sidebarContent.insertBefore(anonFollowedElement, sidebarContent.childNodes[0]);

      await renderPinnedStreamers();

      setInterval(async () => {
        if (!isTabVisible) {
          return;
        }

        await renderPinnedStreamers();
        logger.info("Refreshed pinned streamers displayed data");
      }, REFRESH_DISPLAYED_DATA_DELAY_MINUTES*60*1000);

      document.getElementById('tps-add-streamer').onclick = promptAddStreamer;

      const mainSection = relevantContent.querySelector('main');

      logger.debug(sidebar, mainSection);
      isWorking = false;
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Pin current streamer button

    const pinCurrentStreamerObserver = new MutationObserver(async () => {
      if (isWorkingPinCurrentStreamer) {
        return;
      }
      if (document.getElementById('tps-pin-current-streamer-container')) {
        return;
      }

      const contentFound = document.querySelector(`${ALL_RELEVANT_CONTENT_SELECTOR} ${FOLLOW_BUTTON_CONTAINER_CLONE_SELECTOR} button[data-a-target*="follow-button"]`);
      logger.debug(contentFound);
      if (!contentFound) {
        return;
      }

      isWorkingPinCurrentStreamer = true;

      renderPinCurrentStreamer();

      isWorkingPinCurrentStreamer = false;
      pinCurrentStreamerObserver.disconnect();
    });
    pinCurrentStreamerObserver.observe(document.body, { childList: true, subtree: true });

  }, 500);
};

(() => {
  logger.info('Started');

  // Modify "locationchange" event
  // From https://stackoverflow.com/a/52809105

  let oldPushState = history.pushState;
  history.pushState = function pushState() {
    let ret = oldPushState.apply(this, arguments);
    window.dispatchEvent(new Event('pushstate'));
    window.dispatchEvent(new Event('locationchange'));
    return ret;
  };

  let oldReplaceState = history.replaceState;
  history.replaceState = function replaceState() {
    let ret = oldReplaceState.apply(this, arguments);
    window.dispatchEvent(new Event('replacestate'));
    window.dispatchEvent(new Event('locationchange'));
    return ret;
  };

  window.addEventListener('popstate', () => {
    window.dispatchEvent(new Event('locationchange'));
  });

  window.addEventListener('locationchange', function () {
    logger.debug('Location changed');
    main();
  });

  main();
})();

const requireDataRefresh = (lastRefreshDate) => {
  if (!lastRefreshDate) {
    return true;
  }

  const now = new Date();

  const differenceMs = now - lastRefreshDate;
  const SECONDS = 1000;
  const MINUTES = 60;
  const differenceMinutes = differenceMs / SECONDS / MINUTES;

  if (differenceMinutes < MINUTES_SINCE_FOCUS_LOST_FOR_REFRESH) {
    return false;
  }

  return true;
};

const refreshPinnedData = async () => {
  const pinned = localStorageGetAllPinned();
  const userNames = pinned.map(p => p.user);

  const fetchedPinned = await batchGetTwitchUsers(userNames);

  fetchedPinned.forEach((fetched) => {
    const foundIndex = pinned.findIndex((user) => user.user.toLowerCase() === fetched?.user?.toLowerCase());
    if (foundIndex < 0) {
      return;
    }

    pinned[foundIndex] = fetched;
  })

  localStorageSetPinned(pinned);
  localStorageSetPinnedRefreshedAt(new Date());
  logger.debug("Pinned data refreshed.");
}

const injectCSS = () => {
  const style = document.createElement('style');
  document.head.appendChild(style);
  style.appendChild(document.createTextNode(css));
};

const promptAddStreamer = async () => {
  // eslint-disable-next-line no-alert
  const streamerUser = prompt('Streamer username:');
  if (!streamerUser) {
    return;
  }

  await addStreamer(streamerUser);
};

const addStreamer = async (streamerUser) => {
  const pinned = localStorageGetAllPinned();

  const found = pinned.find((user) => user.user.toLowerCase() === streamerUser.toLowerCase());
  if (found) {
    logger.info(`Streamer '${streamerUser}' already pinned.`);
    return;
  }

  const [user] = await batchGetTwitchUsers([streamerUser]);
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

  const prevHeight = document.querySelector('.tps-pinned-container')?.getBoundingClientRect()?.height;
  const nextHeight = prevHeight + document.querySelector('.tps-pinned-container > div')?.getBoundingClientRect()?.height;
  document.querySelector('.tps-pinned-container').style.height = `${prevHeight}px`;

  await renderPinnedStreamers();

  document.querySelector('.tps-pinned-container').style.height = `${nextHeight}px`;
  setTimeout(() => { document.querySelector('.tps-pinned-container').style.height = ''; }, 500);
};

const removeStreamer = async (id) => {
  const filtered = localStorageGetAllPinned().filter((p) => p.id !== id && p.id);
  localStorageSetPinned(filtered);

  const prevHeight = document.querySelector('.tps-pinned-container').getBoundingClientRect().height;
  const nextHeight = prevHeight - document.querySelector('.tps-pinned-container > div').getBoundingClientRect().height;
  document.querySelector('.tps-pinned-container').style.height = `${prevHeight}px`;

  await renderPinnedStreamers();

  document.querySelector('.tps-pinned-container').style.height = `${nextHeight}px`;
  setTimeout(() => { document.querySelector('.tps-pinned-container').style.height = ''; }, 500);
};

const renderPinnedStreamers = async () => {
  const pinnedUsers = localStorageGetAllPinned().map(p => p.user);
  const pinnedStreamers = await batchGetTwitchUsers(pinnedUsers);

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

const renderPinCurrentStreamer = () => {
  const currentUrl = new URL(window.location.href);
  const [ _, currentStreamerName ] = currentUrl.pathname.split('/');

  if (!currentStreamerName) {
    return;
  }

  // Rerender if exists
  document.getElementById('tps-pin-current-streamer-container')?.remove();

  const isPinned = localStorageIsPinned(currentStreamerName);

  const pinStreamerCurrentHtml = pinStreamer({
    user: currentStreamerName,
    isPinned,
  });

  document.querySelector(`${ALL_RELEVANT_CONTENT_SELECTOR} ${FOLLOW_BUTTON_CONTAINER_CLONE_SELECTOR}`)
    .outerHTML += pinStreamerCurrentHtml;

  document.getElementById('tps-pin-current-streamer-button').addEventListener('click', async (e) => {
    e.preventDefault();

    if (isPinned) {
      const id = localStorageGetPinned(currentStreamerName)?.id;
      if (!id) {
        logger.error('Could not find pinned streamer:', currentStreamerName);
        return;
      }

      await removeStreamer(id);
    } else {
      await addStreamer(currentStreamerName);
    }

    renderPinCurrentStreamer();
  });
};

// HTML templates

const pinnedHeader = () => {
  const clonedPinnedHeader = document.querySelector(ALL_RELEVANT_CONTENT_SELECTOR).querySelector(HEADER_CLONE_SELECTOR).cloneNode(true);
  const h2 = clonedPinnedHeader.querySelector("h2");
  h2.innerText = "Pinned Channels";
  h2.setAttribute("style", "display:inline-block;");
  clonedPinnedHeader.innerHTML += addBtn();

  return clonedPinnedHeader.outerHTML;
};

const addBtn = () => {
  const clonedBtn = document.querySelector(ALL_RELEVANT_CONTENT_SELECTOR).querySelector(BTN_CLONE_SELECTOR).querySelector(BTN_INNER_CLONE_SELECTOR).cloneNode(true);
  clonedBtn.title = "Add Pinned Streamer";
  clonedBtn.id = "tps-add-streamer";
  clonedBtn.setAttribute("style", "width:20px;height:16px;left:6px;");
  clonedBtn.querySelector("svg").setAttribute("viewBox", "0 0 25 25");
  clonedBtn.querySelector("g").innerHTML = `<path vector-effect="non-scaling-stroke" d="M 12 2 C 6.4889971 2 2 6.4889971 2 12 C 2 17.511003 6.4889971 22 12 22 C 17.511003 22 22 17.511003 22 12 C 22 6.4889971 17.511003 2 12 2 z M 12 4 C 16.430123 4 20 7.5698774 20 12 C 20 16.430123 16.430123 20 12 20 C 7.5698774 20 4 16.430123 4 12 C 4 7.5698774 7.5698774 4 12 4 z M 11 7 L 11 11 L 7 11 L 7 13 L 11 13 L 11 17 L 13 17 L 13 13 L 17 13 L 17 11 L 13 11 L 13 7 L 11 7 z"></path>`;

  return clonedBtn.outerHTML;
};

const pinStreamer = ({ user, isPinned }) => {
  const pinText = isPinned ? 'Unpin' : 'Pin';
  let clonedFollowButtonContainer;
  try {
    clonedFollowButtonContainer = new DOMParser().parseFromString(FollowButtonContainerRawHTML, 'text/html').querySelector('div');
  } catch (error) {
    logger.error('Could not clone follow button container.', error);
    return '';
  }
  if (!clonedFollowButtonContainer) {
    logger.error('Could not clone follow button container.');
    return '';
  }

  clonedFollowButtonContainer.id = 'tps-pin-current-streamer-container';
  const styledWrapper = clonedFollowButtonContainer.querySelector('div div div')?.style;
  styledWrapper?.removeProperty('transform');
  styledWrapper?.setProperty('padding-left', '10px');
  const pinTextDecoration = isPinned ? '●' : '〇';
  clonedFollowButtonContainer.querySelector('span div').innerText = `${pinTextDecoration} ${pinText}`;
  clonedFollowButtonContainer.querySelector('.live-notifications__btn')?.parentElement?.parentElement?.remove();

  const button = clonedFollowButtonContainer.querySelector('button');
  button.id = 'tps-pin-current-streamer-button';
  button.setAttribute('aria-label', `${pinText} ${user}`);
  button.setAttribute('data-a-target', `${pinText.toLocaleLowerCase()}-button`);
  button.setAttribute('data-text-selector',  `${pinText.toLocaleLowerCase()}-button`);
  button.style?.setProperty('height', '30px');
  button.style?.setProperty('font-weight', 'var(--font-weight-semibold');
  button.style?.setProperty('font-size', 'var(--button-text-default');
  if (isPinned) {
    button.style.setProperty('background-color', 'var(--color-background-button-secondary-default)');
    button.parentElement.style = 'background-color: transparent !important';
  } else {
    button.style.setProperty('background-color', 'var(--color-background-button-primary-default)');
  }

  // TODO: Add pin icon. Meanwhile, remove the default heart icon.
  button.querySelector('.InjectLayout-sc-1i43xsx-0')?.remove();

  return clonedFollowButtonContainer.outerHTML;
};

const pinnedStreamer = ({
  user, id, displayName, profileImageURL, isLive, viewers = '', category,
}) => {
  const removeBtn = `<button class="tps-remove-pinned-streamer" data-id="${id}" title="Remove pinned streamer" style="position:absolute;top:-6px;left:2px;z-index:1;">x</button>`;
  const prettyViewers = stylizedViewers(viewers);

  const clonedPinnedStreamer = document.querySelector(`${ALL_RELEVANT_CONTENT_SELECTOR} ${NAV_CARD_CLONE_SELECTOR}`).parentNode.parentNode.cloneNode(true);
  if (!isLive) {
    clonedPinnedStreamer.setAttribute("style", "opacity:0.4;");
  }
  clonedPinnedStreamer.querySelector("a").setAttribute("href", `/${user}`);
  const figure = clonedPinnedStreamer.querySelector(".side-nav-card__avatar");
  figure.setAttribute("aria-label", displayName)
  const img = figure.querySelector("img");
  img.setAttribute("alt", displayName);
  img.setAttribute("src", profileImageURL);
  const metadata = clonedPinnedStreamer.querySelector("[data-a-target='side-nav-card-metadata'] p");
  metadata.title = displayName;
  metadata.innerText = displayName;
  const streamCategory = clonedPinnedStreamer.querySelector("[data-a-target='side-nav-game-title'] p");
  streamCategory.title = isLive ? category : '';
  streamCategory.innerText = isLive ? category : '';
  const liveStatus = clonedPinnedStreamer.querySelector("div[data-a-target='side-nav-live-status']");
  if (!isLive) {
    liveStatus.innerHTML = "";
  } else {
    const liveSpan = liveStatus.querySelector("span");
    liveSpan.setAttribute("aria-label", `${prettyViewers} viewers`);
    liveSpan.innerText = prettyViewers;
  }

  clonedPinnedStreamer.querySelector("div").innerHTML = removeBtn + clonedPinnedStreamer.querySelector("div").innerHTML;

  return clonedPinnedStreamer.outerHTML;
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

/**
 *
 * @param {string} logins
 * @returns {Promise<{
 *   user: string,
 *   displayName: string,
 *   profileImageURL: string,
 *   id: string,
 *   isLive: boolean,
 *   viewers: number,
 *   category: string,
 *   title: string,
 * }[]>} Async array of twitch users data
 */
const batchGetTwitchUsers = async (logins) => {
  if (logins.length === 0) {
    return [];
  }

  const twitchUsers = await twitchGQLRequest({
    query: `query($logins: [String!]!, $all: Boolean!, $skip: Boolean!) {
      users(logins: $logins) {
        login
        id
        broadcastSettings {
          language
          game {
            displayName
            name
          }
          title
        }
        createdAt
        description
        displayName
        followers {
          totalCount
        }
        stream {
          archiveVideo @include(if: $all) {
              id
          }
          createdAt
          id
          type
          viewersCount
        }
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
    variables: { logins, all: false, skip: false },
  });

  const result = twitchUsers.data.users.map(user => {
    if (!user) {
      return {};
    }

    return {
      user: user.login,
      displayName: user.displayName,
      profileImageURL: user.profileImageURL,

      id: user.id,
      isLive: user?.stream?.type,
      viewers: user?.stream?.viewersCount,
      category: user?.broadcastSettings?.game?.displayName,
      title: user?.broadcastSettings?.title,
    };
  });

  return result;
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

const localStorageGetAllPinned = () => {
  const lsPinned = localStorage.getItem('tps:pinned');
  return lsPinned ? JSON.parse(lsPinned) : [];
};

const localStorageGetPinned = (user) => {
  const pinned = localStorageGetAllPinned();
  return pinned.find((p) => p.user.toLowerCase() === user.toLowerCase());
};

const localStorageSetPinned = (data) => {
  localStorage.setItem('tps:pinned', JSON.stringify(data));
  return true;
};

const localStorageIsPinned = (user) => {
  const pinned = localStorageGetAllPinned();
  return !!pinned.find((p) => p.user.toLowerCase() === user.toLowerCase());
};

const localStorageGetPinnedRefreshedAt = () => {
  const pinnedRefreshedAt = localStorage.getItem('tps:pinned:refreshed_at');
  return pinnedRefreshedAt ? new Date(pinnedRefreshedAt) : new Date();
};

const localStorageSetPinnedRefreshedAt = (date) => {
  localStorage.setItem('tps:pinned:refreshed_at', date.toISOString());
  return true;
};

// Raw HTML

const FollowButtonContainerRawHTML = `
  <div class="Layout-sc-1xcs6mc-0 cwtKyw">
      <div class="Layout-sc-1xcs6mc-0 grllUE">
          <div style="opacity: 1; transform: translateX(50px) translateZ(0px);">
              <div class="Layout-sc-1xcs6mc-0 lmNILC">
                  <div class="Layout-sc-1xcs6mc-0 bzcGMK">
                      <div class="Layout-sc-1xcs6mc-0 hkISPQ">
                          <div style="opacity: 1;">
                              <div class="Layout-sc-1xcs6mc-0 bXHHlg">
                                  <div class="Layout-sc-1xcs6mc-0 fVQeCA"><button aria-label="Follow _____" data-a-target="follow-button" data-test-selector="follow-button" class="ScCoreButton-sc-ocjdkq-0 iumXyx">
                                          <div class="ScCoreButtonLabel-sc-s7h2b7-0 gPDjGr">
                                              <div data-a-target="tw-core-button-label-text" class="Layout-sc-1xcs6mc-0 bFxzAY">
                                                  <div class="Layout-sc-1xcs6mc-0 ktLpvM">
                                                      <div class="InjectLayout-sc-1i43xsx-0 bgnKmX" style="transition: transform; opacity: 1;">
                                                          <div class="ScAnimation-sc-s60rmz-0 kCyYsz tw-animation" data-a-target="tw-animation-target">
                                                              <div class="Layout-sc-1xcs6mc-0 ktLpvM">
                                                                  <div class="InjectLayout-sc-1i43xsx-0 kBtJDm">
                                                                      <figure class="ScFigure-sc-1hrsqw6-0 btGeNA tw-svg"><svg width="20px" height="20px" version="1.1" viewBox="0 0 20 20" x="0px" y="0px" class="ScSvg-sc-1hrsqw6-1 ihOSMR">
                                                                              <g>
                                                                                  <path fill-rule="evenodd" d="M9.171 4.171A4 4 0 006.343 3H6a4 4 0 00-4 4v.343a4 4 0 001.172 2.829L10 17l6.828-6.828A4 4 0 0018 7.343V7a4 4 0 00-4-4h-.343a4 4 0 00-2.829 1.172L10 5l-.829-.829zm.829 10l5.414-5.414A2 2 0 0016 7.343V7a2 2 0 00-2-2h-.343a2 2 0 00-1.414.586L10 7.828 7.757 5.586A2 2 0 006.343 5H6a2 2 0 00-2 2v.343a2 2 0 00.586 1.414L10 14.172z" clip-rule="evenodd"></path>
                                                                              </g>
                                                                          </svg></figure>
                                                                  </div>
                                                              </div>
                                                          </div>
                                                      </div><span>
                                                          <div style="transition: all; opacity: 1;">Follow</div>
                                                      </span>
                                                  </div>
                                              </div>
                                          </div>
                                      </button></div>
                              </div>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      </div>
  </div>
`;
