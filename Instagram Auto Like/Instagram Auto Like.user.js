// ==UserScript==
// @name Instagram Auto Like
// @description instagram.com like personal feed, auto liker.
// @namespace https://github.com/vekvoid/UserScripts
// @homepageURL https://github.com/vekvoid/UserScripts/tree/main/Instagram%20Auto%20Like
// @supportURL  https://github.com/vekvoid/UserScripts/issues
// @match https://*.instagram.com/*
// @grant none
// @icon https://www.google.com/s2/favicons?domain=instagram.com
// @version 1.1.2
// ==/UserScript==

const logLevels = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

const CURRENT_LOG_LEVEL = logLevels.info;
const DETECT_PAGE_CHANGE_INTERVAL = 1000;
const POSTS_CONTAINER_SELECTOR = 'main > div > div > div > div:nth-child(2) > div > div:nth-child(3)';
const LIKE_BUTTONS_SELECTOR = '[role="button"]';
const LIKE_ICONS_SELECTOR = 'svg[aria-label="Like"]';
const OBSERVING_CLASS_NAME = 'ial-observing';
const NOT_OBSERVING_LIKE_ICONS_SELECTOR = `${LIKE_BUTTONS_SELECTOR}:not(.${OBSERVING_CLASS_NAME}) ${LIKE_ICONS_SELECTOR}`;

const logger = {
  trace: (...args) => (logLevels.trace >= CURRENT_LOG_LEVEL) && console.trace(...args),
  debug: (...args) => (logLevels.debug >= CURRENT_LOG_LEVEL) && console.log(...args),
  info: (...args) => (logLevels.info >= CURRENT_LOG_LEVEL) && console.info(...args),
  warn: (...args) => (logLevels.warn >= CURRENT_LOG_LEVEL) && console.warn(...args),
  error: (...args) => (logLevels.error >= CURRENT_LOG_LEVEL) && console.error(...args),
  fatal: (...args) => (logLevels.fatal >= CURRENT_LOG_LEVEL) && console.fatal(...args),
};

let likes = 0;
let currentPage = window.top.location.href;
let previousPage = "";

(() => {
  logger.info("Instagram Auto Like Started");

  setInterval(() => {
    currentPage = window.top.location.href.split("#")[0];

    if (currentPage === previousPage) {
      return;
    }

    previousPage = currentPage;

    main();
  }, DETECT_PAGE_CHANGE_INTERVAL);
})();

function simulateClicks(el, eventType){
  if (el.fireEvent) {
    el.fireEvent('on' + evntType);
  } else {
    var evObj = document.createEvent('Events');
    evObj.initEvent(eventType, true, false);
    el.dispatchEvent(evObj);
  }
  likes++;
}

const likeButtonObserver = new IntersectionObserver((entries, observer) => {
  entries.forEach(entry => {
    if(entry.isIntersecting && entry.target.querySelector('svg[aria-label="Like"]')) {
      try {
        simulateClicks(entry.target.firstChild.firstChild, 'click');
        logger.debug(likes + " likes for this session");
        observer.unobserve(entry.target);
        entry.target.classList.remove("ctm-observing");
      } catch(err) {
        logger.warn(err.message)
      }
    }
  });
}, {
  threshold: [1],
  rootMargin: '0px 0px -110px 0px', // Spacing to see the Like button animation.
});

const startObservingPostLikeButton = (post) => {
  const likeSvg = post.querySelector(NOT_OBSERVING_LIKE_ICONS_SELECTOR);
  if (likeSvg) {
    logger.debug("likesvg", likeSvg)
    const likeBtn = likeSvg.closest(LIKE_BUTTONS_SELECTOR);
    likeBtn.classList.add(OBSERVING_CLASS_NAME);
    likeButtonObserver.observe(likeBtn);
    logger.debug("observing like btn", likeBtn)
  }
};

const articlesObserver = new MutationObserver((mutations) => {
  logger.debug("mutations", mutations)
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.tagName !== "ARTICLE") {
        return;
      }

      logger.debug(node);
      startObservingPostLikeButton(node);
    });
  });
});

const mainSectionObserver = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      logger.debug("mainSectionObserver", node);

      const mainContent = document.querySelector(POSTS_CONTAINER_SELECTOR);
      if (!mainContent) {
        return;
      }

      mainContent.querySelectorAll("article").forEach(startObservingPostLikeButton);
      articlesObserver.observe(mainContent, {attributes: true, childList: true, characterData: false, subtree:true});
    });
  });
});

let waitForMainContainer;

const main = () => {
  let mainContent;

  if (waitForMainContainer) {
    clearInterval(waitForMainContainer);
  }

  waitForMainContainer = setInterval(() => {
     mainContent = document.querySelector(POSTS_CONTAINER_SELECTOR);

    if (!mainContent) {
      return;
    }

    if (mainContent.querySelectorAll("article").length < 2) {
      return;
    }

    clearInterval(waitForMainContainer);

    logger.debug('Instagram Auto Like: Main content found.');

    mainContent.querySelectorAll("article").forEach(startObservingPostLikeButton);

    articlesObserver.observe(mainContent, {attributes: true, childList: true, characterData: false, subtree:true});

    mainSectionObserver.observe(document.querySelector("main"), { childList: true });
  }, 500);
};
