// ==UserScript==
// @name Instagram Feed Auto Like
// @description instagram.com like personal feed, auto liker.
// @namespace https://github.com/vekvoid/UserScripts
// @homepageURL https://github.com/vekvoid/UserScripts/tree/main/Instagram%20Feed%20Auto%20Like
// @downloadURL https://github.com/vekvoid/UserScripts/raw/main/Instagram%20Feed%20Auto%20Like/Instagram%20Feed%20Auto%20Like.user.js
// @updateURL   https://github.com/vekvoid/UserScripts/raw/main/Instagram%20Feed%20Auto%20Like/Instagram%20Feed%20Auto%20Like.user.js
// @supportURL  https://github.com/vekvoid/UserScripts/issues
// @match https://*.instagram.com/*
// @grant none
// @version 1.0.0
// ==/UserScript==

const DETECT_PAGE_CHANGE_INTERVAL = 1000;
const POSTS_CONTAINER_SELECTOR = '.cGcGK  > div:nth-child(2)';
const LIKE_BUTTONS_CONTAINER_SELECTOR = '.fr66n';
const LIKE_ICONS_SELECTOR = 'svg[aria-label="Like"]';
const OBSERVING_CLASS_NAME = 'ifal-observing';
const NOT_OBSERVING_LIKE_ICONS_SELECTOR = `${LIKE_BUTTONS_CONTAINER_SELECTOR}:not(.${OBSERVING_CLASS_NAME}) ${LIKE_ICONS_SELECTOR}`;

let likes = 0;
let currentPage = window.top.location.href;
let previousPage = "";

window.addEventListener('DOMContentLoaded', () => {
  setInterval(() => {
    currentPage = window.top.location.href.split("#")[0];

    if (currentPage === previousPage) {
      return;
    }

    previousPage = currentPage;

    main();
  }, DETECT_PAGE_CHANGE_INTERVAL);
});

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
        console.log(likes + " likes for this session");
        observer.unobserve(entry.target);
        entry.target.classList.remove("ctm-observing");
      } catch(err) {
        console.warn(err.message) 
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
    // console.log("likesvg", likeSvg)
    const likeBtn = likeSvg.closest(LIKE_BUTTONS_CONTAINER_SELECTOR);
    likeBtn.classList.add(OBSERVING_CLASS_NAME);
    likeButtonObserver.observe(likeBtn);
    // console.log("observing like btn", likeBtn)
  }
};

const articlesObserver = new MutationObserver((mutations) => {
  // console.log("mutations", mutations)
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.tagName !== "ARTICLE") {
        return;
      }

      // console.log(node);
      startObservingPostLikeButton(node);
    });
  });
});

const mainSectionObserver = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      console.log("mainSectionObserver", node);

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
      
    console.log('Instagram Feed Auto Like');
  
    mainContent.querySelectorAll("article").forEach(startObservingPostLikeButton);

    articlesObserver.observe(mainContent, {attributes: true, childList: true, characterData: false, subtree:true});
    
    mainSectionObserver.observe(document.querySelector("main"), { childList: true });
  }, 500);
};
