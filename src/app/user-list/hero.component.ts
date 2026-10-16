import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  NgZone,
  OnDestroy,
  inject,
} from '@angular/core';
import { gsap } from 'gsap';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

interface SolariTile {
  el: HTMLElement;
  current: string;
  htop: HTMLElement;
  hbot: HTMLElement;
  ftop: HTMLElement;
  fbot: HTMLElement;
  ftopc: HTMLElement;
  fbotc: HTMLElement;
  busy: boolean;
  glitchTimer: number | null;
}

type SiteTheme = 'dark' | 'light';

@Component({
  selector: 'app-hero',
  standalone: true,
  templateUrl: 'hero.component.html',
  styleUrls: ['hero.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeroComponent implements AfterViewInit, OnDestroy {
  private readonly ngZone = inject(NgZone);

  private readonly solariTarget = 'PORTFOLIO';
  private readonly solariChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  private readonly solariGlitchChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%*+!?';
  private readonly solariFlipMs = 105;
  private readonly themeStorageKey = 'aristide-portfolio-theme';
  private readonly motion = {
    duration: {
      fast  : 0.24,
      normal: 0.52,
      reveal: 0.76,
      slow  : 0.9,
    },
    ease: {
      enter : 'power4.out',
      move  : 'power3.inOut',
      exit  : 'power2.in',
      scroll: 'power3.inOut',
    },
    stagger: {
      tight : 0.035,
      normal: 0.06,
    },
    distance: {
      reveal: 24,
      hero  : 36,
      card  : 44,
    },
    scrub: {
      work  : 0.65,
      reveal: 0.45,
    },
  } as const;
  private readonly motionEase = this.motion.ease.scroll;

  private get solariFlipTotal(): number {
    return this.solariFlipMs * 2 + 25;
  }

  private perfLite = false;
  private isDestroyed = false;
  private heroAnimationsStarted = false;
  private solariBoardInitialized = false;
  private animations: gsap.core.Animation[] = [];
  private cleanupFns: Array<() => void> = [];
  private solariTiles: SolariTile[] = [];
  private solariTimers = new Set<number>();
  private solariRunId = 0;
  private solariScopeAttr: string | null = null;
  private solariIntroInProgress = false;
  private localTimeTimer: number | null = null;
  private localTimeAligner: number | null = null;
  private backgroundDateTimer: number | null = null;
  private aboutTextRevealTweens: gsap.core.Tween[] = [];
  private aboutTextRevealReady = false;
  private aboutTextRevealPlayed = false;
  private pageScrollTween: gsap.core.Tween | null = null;
  private scrollRefreshFrame: number | null = null;

  private triggerMobileNotesAnimation: (() => void) | null = null;

  ngAfterViewInit(): void {
    this.ngZone.runOutsideAngular(() => {
      this.perfLite = this.isPerformanceModeEnabled();
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });

      this.setupMotionChoreography();
      this.applyPerformanceClasses();
      this.setupSectionMotionVisibility();
      this.setupSolariBoard();
      this.setupLocalTime();
      this.setupBackgroundInstrumentation();
      this.setupNotesWidget();
      this.setupThemeToggle();
      this.setupNavScrolling();
      this.setupContactForms();
      this.setupMicroInteractions();
      this.setupAboutReveal();
      this.setupWorkHorizontalScroll();

      this.playLandingLoader().finally(() => {
        if (this.isDestroyed) return;
        this.startHeroAnimations();
        this.setupSkillsReveal();
        this.setupContactReveal();
        this.setupContactTypewriter();
        this.setupScrollTextReveals();
      });
    });
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;

    this.animations.forEach((animation) => {
      try { animation.kill(); } catch (_) {}
    });
    this.animations = [];
    try { this.pageScrollTween?.kill(); } catch (_) {}
    this.pageScrollTween = null;
    if (this.scrollRefreshFrame !== null) {
      window.cancelAnimationFrame(this.scrollRefreshFrame);
      this.scrollRefreshFrame = null;
    }

    this.cleanupFns.forEach((fn) => {
      try { fn(); } catch (_) {}
    });
    this.cleanupFns = [];

    this.clearSolariTimers();
  }

  // ---------------------------------------------------------------------------
  // About Section — scroll-triggered box expansion
  // ---------------------------------------------------------------------------

  private setupMotionChoreography(): void {
    gsap.defaults({
      ease: this.motion.ease.enter,
      overwrite: 'auto',
    });
  }

  private setupSectionMotionVisibility(): void {
    const sections = Array.from(document.querySelectorAll<HTMLElement>(
      '.hero, .about-section, .work-horizontal-section, .skills-runway-section, .contact-section'
    ));
    if (sections.length === 0) return;

    if (typeof IntersectionObserver === 'undefined') {
      sections.forEach((section) => section.classList.add('is-motion-active'));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle('is-motion-active', entry.isIntersecting);
      });
    }, {
      rootMargin: '18% 0px',
      threshold: 0.01,
    });

    sections.forEach((section) => observer.observe(section));
    this.cleanupFns.push(() => {
      observer.disconnect();
      sections.forEach((section) => section.classList.remove('is-motion-active'));
    });
  }

  private setupMicroInteractions(): void {
    const root = document.querySelector<HTMLElement>('.page-canvas');
    if (!root) return;

    const targetSelector = [
      'a[href]',
      'button',
      'input',
      'textarea',
      'select',
      '.service-link',
      '.work-experience-card',
      '.tech-stack-card',
      '.skills-runway-row',
      '.contact-form-panel',
      '.notes-widget-panel',
    ].join(', ');
    const cardSelector = [
      '.service-link',
      '.work-experience-card',
      '.tech-stack-card',
      '.skills-runway-row',
      '.contact-form-panel',
      '.notes-widget-panel',
    ].join(', ');
    const controlSelector = 'a[href], button';
    const fieldSelector = 'input, textarea, select';
    const reducedMotion = this.prefersReducedMotion();
    const pressedTargets = new Set<HTMLElement>();

    root.classList.add('has-microinteractions');

    const hydrateMicroTargets = (scope: ParentNode = root): void => {
      scope.querySelectorAll<HTMLElement>(targetSelector).forEach((element) => {
        element.classList.add('ui-micro-target');

        if (element.matches(controlSelector)) {
          element.classList.add('ui-micro-control', 'ui-micro-ripple-host');
        }

        if (element.matches(fieldSelector)) {
          element.classList.add('ui-micro-field');
        }

        if (element.matches(cardSelector)) {
          element.classList.add('ui-micro-card');
        }
      });
    };

    const getMicroTarget = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null;

      const candidate = target.closest<HTMLElement>('.ui-micro-target, .ui-micro-card');
      return candidate && root.contains(candidate) ? candidate : null;
    };

    const clearPressedTargets = (): void => {
      pressedTargets.forEach((target) => target.classList.remove('is-micro-pressed'));
      pressedTargets.clear();
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || reducedMotion || !(event.target instanceof Element)) return;

      const target = event.target.closest<HTMLElement>('.ui-micro-ripple-host');
      if (!target || !root.contains(target) || target.matches(':disabled, [aria-disabled="true"]')) return;

      const rect = target.getBoundingClientRect();
      const rippleSize = Math.max(rect.width, rect.height) * 2.35;
      const ripple = document.createElement('span');

      ripple.className = 'ui-micro-ripple';
      ripple.style.setProperty('--micro-ripple-x', `${event.clientX - rect.left}px`);
      ripple.style.setProperty('--micro-ripple-y', `${event.clientY - rect.top}px`);
      ripple.style.setProperty('--micro-ripple-size', `${rippleSize}px`);

      target.classList.add('is-micro-pressed');
      pressedTargets.add(target);
      target.appendChild(ripple);

      ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    };

    const onFocusIn = (event: FocusEvent): void => {
      const target = getMicroTarget(event.target);
      target?.classList.add('is-micro-focused');

      if (event.target instanceof Element) {
        event.target.closest('label')?.classList.add('is-micro-focused');
      }
    };

    const onFocusOut = (event: FocusEvent): void => {
      const target = getMicroTarget(event.target);
      target?.classList.remove('is-micro-focused');

      if (event.target instanceof Element) {
        event.target.closest('label')?.classList.remove('is-micro-focused');
      }
    };

    hydrateMicroTargets();

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            if (node.matches(targetSelector)) {
              hydrateMicroTargets(node.parentNode ?? root);
            } else {
              hydrateMicroTargets(node);
            }
          }
        });
      });
    });

    observer.observe(root, { childList: true, subtree: true });

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointerup', clearPressedTargets);
    root.addEventListener('pointercancel', clearPressedTargets);
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);

    this.cleanupFns.push(() => {
      observer.disconnect();
      clearPressedTargets();
      root.classList.remove('has-microinteractions');
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointerup', clearPressedTargets);
      root.removeEventListener('pointercancel', clearPressedTargets);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
    });
  }

  private setupAboutReveal(): void {
    const section = document.querySelector<HTMLElement>('.about-section');
    const box     = document.querySelector<HTMLElement>('.about-reveal-box');

    if (!section || !box) return;

    const pageCanvas = document.querySelector<HTMLElement>('.page-canvas');
    const platform   = box.querySelector<HTMLElement>('.about-platform');
    const platformLightSurface = platform?.querySelector<HTMLElement>('.about-platform-light-surface') ?? null;
    const contentMask = box.querySelector<HTMLElement>('.about-content-mask');
    const label      = box.querySelector<HTMLElement>('.about-box-label');
    const labelInner = box.querySelector<HTMLElement>('.about-box-label-inner');
    const titleWord  = box.querySelector<HTMLElement>('.about-title-word');
    const toggle     = box.querySelector<HTMLButtonElement>('.about-panel-toggle');
    const moreButton = box.querySelector<HTMLButtonElement>('[data-about-more-open]');
    const morePage = document.querySelector<HTMLElement>('[data-about-more-page]');
    const moreBackButton = morePage?.querySelector<HTMLButtonElement>('[data-about-more-back]') ?? null;
    const portrait   = box.querySelector<HTMLElement>('.about-portrait');
    const description = box.querySelector<HTMLElement>('.about-description');
    const cornerMarker = box.querySelector<HTMLElement>('.about-corner-marker');
    const progressRail = box.querySelector<HTMLElement>('.about-progress-rail');
    const progressTicks = progressRail
      ? Array.from(progressRail.querySelectorAll<HTMLElement>('.about-progress-tick'))
      : [];
    const darkSections = description
      ? Array.from(description.querySelectorAll<HTMLElement>('[data-about-theme="dark"]'))
      : [];
    const skillCardList = description?.querySelector<HTMLElement>('.about-skill-list') ?? null;
    const skillCards = skillCardList
      ? Array.from(skillCardList.querySelectorAll<HTMLElement>('li'))
      : [];
    let revealed = false;
    let aboutContentReady = false;
    let activeAboutTheme: 'light' | 'dark' = 'light';
    let revealTimeline: gsap.core.Timeline | null = null;
    let isFullScreen = false;
    let panelToggleTimeline: gsap.core.Timeline | null = null;
    let platformThemeTween: gsap.core.Tween | null = null;
    let activeSkillCardIndex = 0;
    let aboutMoreLastFocus: HTMLElement | null = null;
    let previousBodyOverflow: string | null = null;
    let previousDocumentOverflow: string | null = null;
    let aboutMoreCloseTimer: number | null = null;

    this.aboutTextRevealReady = false;
    this.aboutTextRevealPlayed = false;

    const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);
    const getAboutStoryProgress = (): number => {
      const maxScroll = Math.max(1, section.offsetHeight - window.innerHeight);
      return clamp01(-section.getBoundingClientRect().top / maxScroll);
    };

    const getCurrentPanelState = () => {
      const states = this.getAboutPlatformStates(box, labelInner);
      return isFullScreen ? states.fullscreen : states.expanded;
    };

    const setAboutPlatformTheme = (theme: 'light' | 'dark'): void => {
      if (!platform || activeAboutTheme === theme) return;

      activeAboutTheme = theme;
      box.classList.toggle('is-dark-theme', theme === 'dark');

      const target = theme === 'dark'
        ? {
            '--about-platform-bg'    : '#101010',
            '--about-platform-wash'  : 'rgba(56, 176, 255, 0.08)',
            '--about-platform-border': 'rgba(255, 255, 255, 0.18)',
            '--about-platform-shadow': 'rgba(0, 0, 0, 0.68)',
          }
          : {
            '--about-platform-bg'    : '#ffffff',
            '--about-platform-wash'  : 'rgba(217, 166, 54, 0.03)',
            '--about-platform-border': 'rgba(255, 255, 255, 0.72)',
            '--about-platform-shadow': 'rgba(0, 0, 0, 0.42)',
          };
      const duration = this.prefersReducedMotion() ? 0 : 0.58;

      try { platformThemeTween?.kill(); } catch (_) {}
      platformThemeTween = gsap.to(platform, {
        ...target,
        duration,
        ease     : 'power2.inOut',
        overwrite: 'auto',
      });

    };

    const updateAboutPlatformTheme = (): void => {
      if (!aboutContentReady || !description || darkSections.length === 0) return;

      const rootRect = description.getBoundingClientRect();
      const focusY = rootRect.top + rootRect.height * 0.42;
      const isDarkActive = darkSections.some((darkSection) => {
        const rect = darkSection.getBoundingClientRect();
        return rect.top <= focusY && rect.bottom >= focusY;
      });

      setAboutPlatformTheme(isDarkActive ? 'dark' : 'light');
    };

    const setPlatformState = (expanded: boolean): void => {
      if (!platform) return;
      const states = this.getAboutPlatformStates(box, labelInner);
      const targetState = expanded
        ? (isFullScreen ? states.fullscreen : states.expanded)
        : states.compact;
      gsap.set(platform, {
        ...targetState,
      });
      if (contentMask) {
        gsap.set(contentMask, {
          ...targetState,
        });
      }
      if (toggle) gsap.set(toggle, this.getAboutTogglePlacement(box, targetState));
      if (cornerMarker) {
        gsap.set(cornerMarker, this.getAboutCornerMarkerPlacement(box, targetState));
      }
      if (progressRail) {
        gsap.set(progressRail, this.getAboutProgressRailPlacement(box, targetState));
      }
      if (portrait && expanded) {
        gsap.set(portrait, this.getAboutPortraitPlacement(box, targetState));
      }
      if (description && expanded) {
        gsap.set(description, this.getAboutDescriptionPlacement(box, targetState));
      }
    };

    const updateAboutProgress = (): void => {
      if (!progressRail || progressTicks.length === 0) return;

      const storyProgress = getAboutStoryProgress();

      progressRail.style.setProperty('--about-progress', storyProgress.toFixed(4));
      progressTicks.forEach((tick, index) => {
        tick.classList.toggle('is-active', index === 0);
        tick.classList.remove('is-passed');
      });
    };

    const updateAboutStoryScroll = (): void => {
      if (!revealed || !aboutContentReady) return;

      const panelState = getCurrentPanelState();

      if (cornerMarker) {
        gsap.set(cornerMarker, {
          ...this.getAboutCornerMarkerPlacement(box, panelState),
          autoAlpha: 1,
          y        : 0,
        });
      }
      if (portrait) {
        gsap.set(portrait, {
          ...this.getAboutPortraitPlacement(box, panelState),
          y      : 0,
          opacity: 1,
        });
      }
      if (description) {
        gsap.set(description, {
          ...this.getAboutDescriptionPlacement(box, panelState),
          y            : 0,
          opacity      : 1,
          pointerEvents: 'auto',
        });
      }
    };

    const updateSkillCardStack = (): void => {
      if (skillCards.length === 0) return;

      skillCards.forEach((card, index) => {
        const stackPosition = (index - activeSkillCardIndex + skillCards.length) % skillCards.length;
        const isActive = stackPosition === 0;

        card.classList.toggle('is-active', isActive);
        card.classList.toggle('is-next', stackPosition === 1);
        card.classList.toggle('is-back', stackPosition === 2);
        card.classList.toggle('is-hidden', stackPosition > 2);
        card.style.setProperty('--skill-stack-position', String(stackPosition));
        card.tabIndex = isActive ? 0 : -1;
        card.setAttribute('aria-hidden', String(!isActive));
        card.setAttribute('aria-label', isActive ? 'Show next skill card' : 'Stacked skill card');
      });
    };

    const showNextSkillCard = (): void => {
      if (skillCards.length <= 1) return;

      activeSkillCardIndex = (activeSkillCardIndex + 1) % skillCards.length;
      updateSkillCardStack();
    };

    const onSkillCardClick = (event: MouseEvent): void => {
      const card = event.currentTarget as HTMLElement | null;
      if (!card?.classList.contains('is-active')) return;

      showNextSkillCard();
    };

    const onSkillCardKeydown = (event: KeyboardEvent): void => {
      const card = event.currentTarget as HTMLElement | null;
      if (!card?.classList.contains('is-active')) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;

      event.preventDefault();
      showNextSkillCard();
    };

    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !revealed) {
            revealed = true;
            revealTimeline = this.revealAboutPlatform(
              box,
              platform,
              platformLightSurface,
              label,
              labelInner,
              titleWord,
              toggle,
              portrait,
              description,
              cornerMarker,
              progressRail,
              contentMask
            );
            revealTimeline.eventCallback('onComplete', () => {
              aboutContentReady = true;
              updateAboutStoryScroll();
              updateAboutProgress();
              updateAboutPlatformTheme();
              this.aboutTextRevealReady = true;
              this.playAboutTextReveals();
              this.startAboutProfileTypewriter();
              this.refreshScrollTextReveals();
            });

            revealObserver.disconnect();
          }
        }
      },
      { threshold: 0.16 }
    );

    gsap.set(box, {
      opacity  : 0,
      clipPath : 'inset(0px 0px 0px 0px)',
    });
    setPlatformState(false);
    if (contentMask) {
      const states = this.getAboutPlatformStates(box, labelInner);
      gsap.set(contentMask, {
        ...states.compact,
        autoAlpha: 1,
      });
    }
    if (platform) {
      gsap.set(platform, {
        autoAlpha                 : 1,
        '--about-platform-bg'     : 'transparent',
        '--about-platform-wash'   : 'rgba(0, 0, 0, 0)',
        '--about-platform-border' : 'rgba(255, 255, 255, 0)',
        '--about-platform-shadow' : 'rgba(0, 0, 0, 0)',
      });
    }
    if (label) gsap.set(label, { autoAlpha: 1 });
    if (labelInner) gsap.set(labelInner, { opacity: 0, y: 20, scale: 1 });
    if (toggle) gsap.set(toggle, { autoAlpha: 0, scale: 0.96, pointerEvents: 'none' });
    if (cornerMarker) {
      const states = this.getAboutPlatformStates(box, labelInner);
      cornerMarker.setAttribute('data-panel-state', 'collapsed');
      gsap.set(cornerMarker, {
        ...this.getAboutCornerMarkerPlacement(box, states.expanded),
        autoAlpha: 0,
        y: 10,
      });
    }
    if (platformLightSurface) gsap.set(platformLightSurface, { opacity: 0 });
    if (progressRail) {
      const states = this.getAboutPlatformStates(box, labelInner);
      gsap.set(progressRail, {
        ...this.getAboutProgressRailPlacement(box, states.expanded),
        autoAlpha: 0,
        y: 8,
      });
      progressRail.style.setProperty('--about-progress', '0');
    }
    if (portrait) {
      const states = this.getAboutPlatformStates(box, labelInner);
      gsap.set(portrait, {
        ...this.getAboutPortraitPlacement(box, states.expanded),
        opacity: 0,
        y      : 22,
      });
    }
    if (description) {
      const states = this.getAboutPlatformStates(box, labelInner);
      gsap.set(description, {
        ...this.getAboutDescriptionPlacement(box, states.expanded),
        opacity: 0,
        y      : 26,
        pointerEvents: 'none',
      });
    }
    if (titleWord) {
      gsap.set(titleWord, {
        color     : '#f3eee5',
        textShadow: '0 0 26px rgba(255, 232, 187, 0.22), 0 18px 46px rgba(0, 0, 0, 0.34)',
      });
    }

    let aboutResizeFrame: number | null = null;
    const onResize = (): void => {
      if (aboutResizeFrame !== null) return;

      aboutResizeFrame = window.requestAnimationFrame(() => {
        aboutResizeFrame = null;
        setPlatformState(revealed);
        updateAboutStoryScroll();
        updateAboutProgress();
        updateAboutPlatformTheme();
        this.refreshScrollTextReveals();
      });
    };

    const setPanelFullscreen = (nextFullScreen: boolean): void => {
      if (!revealed || !platform || !toggle) return;

      isFullScreen = nextFullScreen;
      const states = this.getAboutPlatformStates(box, labelInner);
      const targetState = isFullScreen ? states.fullscreen : states.expanded;

      toggle.classList.toggle('is-fullscreen', isFullScreen);
      toggle.setAttribute('aria-label', isFullScreen ? 'Collapse about panel' : 'Expand about panel');
      toggle.setAttribute('aria-pressed', String(isFullScreen));
      if (cornerMarker) {
        cornerMarker.classList.toggle('is-fullscreen', isFullScreen);
        cornerMarker.setAttribute('data-panel-state', isFullScreen ? 'expanded' : 'collapsed');
      }

      try { panelToggleTimeline?.kill(); } catch (_) {}
      panelToggleTimeline = gsap.timeline({ defaults: { duration: this.prefersReducedMotion() ? 0 : 0.7, ease: 'power3.inOut' } });
      panelToggleTimeline
        .to(platform, { ...targetState }, 0)
        .to(toggle, { ...this.getAboutTogglePlacement(box, targetState) }, 0);
      if (contentMask) {
        panelToggleTimeline.to(contentMask, { ...targetState }, 0);
      }
      if (cornerMarker) {
        panelToggleTimeline.to(cornerMarker, this.getAboutCornerMarkerPlacement(box, targetState), 0);
      }
      if (progressRail) {
        panelToggleTimeline.to(progressRail, this.getAboutProgressRailPlacement(box, targetState), 0);
      }
      if (portrait) {
        panelToggleTimeline.to(portrait, {
          ...this.getAboutPortraitPlacement(box, targetState),
          y: 0,
        }, 0);
      }
      if (description) {
        panelToggleTimeline.to(description, {
          ...this.getAboutDescriptionPlacement(box, targetState),
          y: 0,
        }, 0);
      }
      panelToggleTimeline.eventCallback('onComplete', () => {
        updateAboutStoryScroll();
        this.refreshScrollTextReveals();
      });
    };

    const onTogglePanel = (): void => {
      setPanelFullscreen(!isFullScreen);
    };

    const setAboutMorePageOpen = (isOpen: boolean, restoreFocus = true): void => {
      if (!morePage) return;

      if (aboutMoreCloseTimer !== null) {
        window.clearTimeout(aboutMoreCloseTimer);
        aboutMoreCloseTimer = null;
      }

      if (isOpen) {
        aboutMoreLastFocus = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : moreButton;
        previousBodyOverflow = document.body.style.overflow;
        previousDocumentOverflow = document.documentElement.style.overflow;
        morePage.hidden = false;
        morePage.setAttribute('aria-hidden', 'false');
        pageCanvas?.classList.add('is-about-more-open');
        moreButton?.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        window.setTimeout(() => moreBackButton?.focus(), 0);
        return;
      }

      pageCanvas?.classList.remove('is-about-more-open');
      morePage.setAttribute('aria-hidden', 'true');
      moreButton?.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = previousBodyOverflow ?? '';
      document.documentElement.style.overflow = previousDocumentOverflow ?? '';
      previousBodyOverflow = null;
      previousDocumentOverflow = null;
      aboutMoreCloseTimer = window.setTimeout(() => {
        aboutMoreCloseTimer = null;
        morePage.hidden = true;
        if (!restoreFocus) return;

        const focusTarget = aboutMoreLastFocus && document.contains(aboutMoreLastFocus)
          ? aboutMoreLastFocus
          : moreButton;
        focusTarget?.focus();
        aboutMoreLastFocus = null;
      }, this.prefersReducedMotion() ? 0 : 240);
    };

    const onMoreExpand = (event: Event): void => {
      event.preventDefault();
      setAboutMorePageOpen(true);
    };

    const onMoreBack = (): void => {
      setAboutMorePageOpen(false);
    };

    const onMorePageKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      setAboutMorePageOpen(false);
    };

    const onAboutMoreCloseRequest = (event: Event): void => {
      const detail = (event as CustomEvent<{ restoreFocus?: boolean }>).detail;
      setAboutMorePageOpen(false, detail?.restoreFocus ?? false);
    };

    // Native <details> allows every row to stay open at once, which is what made the list
    // feel stacked/cluttered — keep it to one open row at a time, accordion-style.
    const moreServiceDetails = morePage
      ? Array.from(morePage.querySelectorAll<HTMLDetailsElement>('.about-more-service-detail'))
      : [];
    const onServiceDetailToggle = (event: Event): void => {
      const target = event.currentTarget as HTMLDetailsElement;
      if (!target.open) return;

      moreServiceDetails.forEach((detail) => {
        if (detail !== target) detail.open = false;
      });
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('about-more:close', onAboutMoreCloseRequest as EventListener);
    if (toggle) toggle.addEventListener('click', onTogglePanel);
    if (moreButton) moreButton.addEventListener('click', onMoreExpand);
    if (moreBackButton) moreBackButton.addEventListener('click', onMoreBack);
    if (morePage) morePage.addEventListener('keydown', onMorePageKeydown);
    moreServiceDetails.forEach((detail) => detail.addEventListener('toggle', onServiceDetailToggle));
    if (skillCardList) {
      skillCardList.setAttribute('aria-live', 'polite');
    }
    skillCards.forEach((card) => {
      card.setAttribute('role', 'button');
      card.addEventListener('click', onSkillCardClick);
      card.addEventListener('keydown', onSkillCardKeydown);
    });
    updateSkillCardStack();
    revealObserver.observe(section);
    updateAboutProgress();

    this.cleanupFns.push(() => {
      revealObserver.disconnect();
      window.removeEventListener('resize', onResize);
      if (aboutResizeFrame !== null) window.cancelAnimationFrame(aboutResizeFrame);
      window.removeEventListener('about-more:close', onAboutMoreCloseRequest as EventListener);
      if (toggle) toggle.removeEventListener('click', onTogglePanel);
      if (moreButton) moreButton.removeEventListener('click', onMoreExpand);
      if (moreBackButton) moreBackButton.removeEventListener('click', onMoreBack);
      if (morePage) morePage.removeEventListener('keydown', onMorePageKeydown);
      moreServiceDetails.forEach((detail) => detail.removeEventListener('toggle', onServiceDetailToggle));
      setAboutMorePageOpen(false, false);
      skillCards.forEach((card) => {
        card.removeEventListener('click', onSkillCardClick);
        card.removeEventListener('keydown', onSkillCardKeydown);
      });
      try { revealTimeline?.kill(); } catch (_) {}
      try { panelToggleTimeline?.kill(); } catch (_) {}
      try { platformThemeTween?.kill(); } catch (_) {}
    });
  }

  private revealAboutPlatform(
    box: HTMLElement,
    platform: HTMLElement | null,
    platformLightSurface: HTMLElement | null,
    label: HTMLElement | null,
    labelInner: HTMLElement | null,
    titleWord: HTMLElement | null,
    toggle: HTMLButtonElement | null,
    portrait: HTMLElement | null,
    description: HTMLElement | null,
    cornerMarker: HTMLElement | null,
    progressRail: HTMLElement | null,
    contentMask: HTMLElement | null
  ): gsap.core.Timeline {
    const speed  = this.perfLite ? 0.48 : 0.62;
    const states = this.getAboutPlatformStates(box, labelInner);
    const tl     = this.track(gsap.timeline({ defaults: { ease: 'power3.out' } }));

    tl.set(box, { opacity: 1 }, 0);
    if (platform) {
      tl.set(platform, {
        ...states.compact,
        autoAlpha                 : 1,
        '--about-platform-bg'     : 'transparent',
        '--about-platform-wash'   : 'rgba(0, 0, 0, 0)',
        '--about-platform-border' : 'rgba(255, 255, 255, 0)',
        '--about-platform-shadow' : 'rgba(0, 0, 0, 0)',
      }, 0);
    }
    if (contentMask) {
      tl.set(contentMask, {
        ...states.compact,
        autoAlpha: 1,
      }, 0);
    }
    if (label) tl.set(label, { autoAlpha: 1 }, 0);

    if (this.prefersReducedMotion()) {
      if (platform) {
        tl.set(platform, {
          ...states.expanded,
          autoAlpha                 : 1,
          '--about-platform-bg'     : '#ffffff',
          '--about-platform-wash'   : 'rgba(217, 166, 54, 0.03)',
          '--about-platform-border' : 'rgba(255, 255, 255, 0.72)',
          '--about-platform-shadow' : 'rgba(0, 0, 0, 0.42)',
        }, 0);
      }
      if (platformLightSurface) tl.set(platformLightSurface, { opacity: 0 }, 0);
      if (contentMask) {
        tl.set(contentMask, {
          ...states.expanded,
          autoAlpha: 1,
        }, 0);
      }
      if (toggle) {
        tl.set(toggle, {
          ...this.getAboutTogglePlacement(box, states.expanded),
          autoAlpha    : 1,
          scale        : 1,
          pointerEvents: 'auto',
        }, 0);
      }
      if (portrait) {
        tl.set(portrait, {
          ...this.getAboutPortraitPlacement(box, states.expanded),
          opacity: 1,
          y      : 0,
        }, 0);
      }
      if (description) {
        tl.set(description, {
          ...this.getAboutDescriptionPlacement(box, states.expanded),
          opacity: 1,
          y      : 0,
          pointerEvents: 'auto',
        }, 0);
      }
      if (cornerMarker) {
        tl.set(cornerMarker, {
          ...this.getAboutCornerMarkerPlacement(box, states.expanded),
          autoAlpha: 1,
          y: 0,
        }, 0);
      }
      if (progressRail) {
        tl.set(progressRail, {
          ...this.getAboutProgressRailPlacement(box, states.expanded),
          autoAlpha: 1,
          y: 0,
        }, 0);
      }
      if (label) tl.set(label, { autoAlpha: 0 }, 0);
      return tl;
    }

    const hasIntroLabel = !!label || !!labelInner || !!titleWord;
    if (!hasIntroLabel) {
      const contentStart = 0.62 * speed;
      const expandDuration = 0.76 * speed;
      const compactScaleX = states.expanded.width > 0
        ? states.compact.width / states.expanded.width
        : 1;
      const compactScaleY = states.expanded.height > 0
        ? states.compact.height / states.expanded.height
        : 1;

      if (platform) {
        // Size the panel once, then reveal it with compositor-only scaling.
        // Animating width/height here caused layout and a full-panel repaint
        // on every frame.
        tl.set(platform, {
          ...states.expanded,
          scaleX                    : compactScaleX,
          scaleY                    : compactScaleY,
          force3D                   : true,
          autoAlpha                 : 1,
          '--about-platform-bg'     : 'transparent',
          '--about-platform-wash'   : 'rgba(0, 0, 0, 0)',
          '--about-platform-border' : 'rgba(255, 255, 255, 0)',
          '--about-platform-shadow' : 'rgba(0, 0, 0, 0)',
        }, 0);
        tl.to(platform, {
          scaleX  : 1,
          scaleY  : 1,
          duration: expandDuration,
          ease                      : 'power3.inOut',
        }, 0);
      }
      if (platformLightSurface) {
        // Crossfading a pre-rendered surface stays on the compositor and
        // avoids repainting a large gradient while the panel is moving.
        tl.set(platformLightSurface, { opacity: 0 }, 0);
        tl.to(platformLightSurface, {
          opacity : 1,
          duration: expandDuration,
          ease    : 'sine.inOut',
        }, 0);
      }
      if (contentMask) {
        tl.set(contentMask, {
          ...states.expanded,
          scaleX : compactScaleX,
          scaleY : compactScaleY,
          force3D: true,
        }, 0);
        tl.to(contentMask, {
          scaleX  : 1,
          scaleY  : 1,
          duration: expandDuration,
          ease    : 'power3.inOut',
        }, 0);
      }
      if (platform) {
        tl.set(platform, {
          '--about-platform-bg'    : '#ffffff',
          '--about-platform-wash'  : 'rgba(217, 166, 54, 0.03)',
        }, expandDuration);
      }
      if (platformLightSurface) {
        tl.set(platformLightSurface, { opacity: 0 }, expandDuration);
      }
      if (cornerMarker) {
        tl.set(cornerMarker, this.getAboutCornerMarkerPlacement(box, states.expanded), contentStart);
        tl.to(cornerMarker, {
          autoAlpha: 1,
          y        : 0,
          duration : 0.32 * speed,
          ease     : 'power2.out',
        }, contentStart + 0.04 * speed);
      }
      if (progressRail) {
        tl.set(progressRail, this.getAboutProgressRailPlacement(box, states.expanded), contentStart);
        tl.to(progressRail, {
          autoAlpha: 1,
          y        : 0,
          duration : 0.28 * speed,
          ease     : 'power2.out',
        }, contentStart + 0.08 * speed);
      }
      if (portrait) {
        tl.set(portrait, {
          ...this.getAboutPortraitPlacement(box, states.expanded),
          opacity: 0,
          y      : 18,
        }, contentStart);
        tl.to(portrait, {
          opacity : 1,
          y       : 0,
          duration: 0.52 * speed,
          ease    : 'power3.out',
        }, contentStart + 0.04 * speed);
      }
      if (description) {
        tl.set(description, {
          ...this.getAboutDescriptionPlacement(box, states.expanded),
          opacity      : 0,
          y            : 20,
          pointerEvents: 'none',
        }, contentStart);
        tl.to(description, {
          opacity      : 1,
          y            : 0,
          pointerEvents: 'auto',
          duration     : 0.56 * speed,
          ease         : 'power3.out',
        }, contentStart + 0.08 * speed);
      }
      if (toggle) {
        tl.set(toggle, {
          ...this.getAboutTogglePlacement(box, states.expanded),
          pointerEvents: 'auto',
        }, contentStart + 0.24 * speed);
        tl.to(toggle, {
          autoAlpha: 1,
          scale    : 1,
          duration : 0.22 * speed,
          ease     : 'power2.out',
        }, contentStart + 0.24 * speed);
      }

      return tl;
    }

    // ── Phase 1: label fades in ───────────────────────────────────────────────
    if (labelInner) {
      tl.to(labelInner, {
        opacity : 1,
        y       : 0,
        duration: 0.72 * speed,
        ease    : 'power3.out',
      }, 0);
    }

    // ── Phase 2: platform warms up (dark → slightly lighter) ─────────────────
    if (platform) {
      tl.to(platform, {
        '--about-platform-bg'     : 'transparent',
        '--about-platform-border' : 'rgba(255, 255, 255, 0)',
        '--about-platform-shadow' : 'rgba(0, 0, 0, 0)',
        duration                  : 0.46 * speed,
        ease                      : 'none',
      }, 0.88 * speed);

      // ── Phase 3: platform flips to light ───────────────────────────────────
      tl.to(platform, {
        '--about-platform-bg'     : '#ffffff',
        '--about-platform-wash'   : 'rgba(217, 166, 54, 0.03)',
        '--about-platform-border' : 'rgba(255, 255, 255, 0.72)',
        '--about-platform-shadow' : 'rgba(0, 0, 0, 0.42)',
        duration                  : 0.9 * speed,
        ease                      : 'sine.inOut',
      }, 1.18 * speed);
    }

    // ── Phase 4: title word colour shifts ─────────────────────────────────────
    if (titleWord) {
      tl.to(titleWord, {
        color     : '#18120a',
        textShadow: '0 1px 0 rgba(255, 255, 255, 0.55), 0 18px 46px rgba(0, 0, 0, 0.14)',
        duration  : 0.62 * speed,
        ease      : 'power2.out',
      }, 1.16 * speed);
    }

    // ── Phase 5: label exits upward — shorter, accelerates out ───────────────
    if (labelInner) {
      tl.to(labelInner, {
        opacity : 0,
        y       : -14,          // exits upward so it feels purposeful
        duration: 0.44 * speed, // was 0.58 — snappier exit
        ease    : 'power2.in',  // accelerates out (was power3.inOut — sluggish start)
      }, 2.02 * speed);         // was 2.16 — starts a beat earlier
    }

    // ── Phase 6: expand — overlaps label exit so there's zero dead gap ────────
    if (platform) {
      tl.to(platform, {
        ...states.expanded,
        '--about-platform-bg'     : '#ffffff',
        '--about-platform-wash'   : 'rgba(217, 166, 54, 0.03)',
        '--about-platform-border' : 'rgba(255, 255, 255, 0.72)',
        '--about-platform-shadow' : 'rgba(0, 0, 0, 0.42)',
        duration                  : 0.88 * speed, // was 1.18 — tighter
        ease                      : 'power3.inOut', // was expo.inOut — starts moving immediately
      }, 2.32 * speed);          // was 2.88 — bridges dead gap; overlaps label exit
    }
    if (contentMask) {
      tl.to(contentMask, {
        ...states.expanded,
        duration: 0.88 * speed,
        ease    : 'power3.inOut',
      }, 2.32 * speed);
    }

    const expandStart = 2.32 * speed;
    const expandDuration = 0.88 * speed;
    const contentStart = expandStart + expandDuration - 0.02 * speed;

    if (label) tl.set(label, { autoAlpha: 0 }, contentStart);
    if (cornerMarker) {
      tl.set(cornerMarker, this.getAboutCornerMarkerPlacement(box, states.expanded), contentStart);
      tl.to(cornerMarker, {
        autoAlpha: 1,
        y        : 0,
        duration : 0.38 * speed,
        ease     : 'power2.out',
      }, contentStart + 0.08 * speed);
    }
    if (progressRail) {
      tl.set(progressRail, this.getAboutProgressRailPlacement(box, states.expanded), contentStart);
      tl.to(progressRail, {
        autoAlpha: 1,
        y        : 0,
        duration : 0.34 * speed,
        ease     : 'power2.out',
      }, contentStart + 0.16 * speed);
    }
    if (portrait) {
      tl.set(portrait, {
        ...this.getAboutPortraitPlacement(box, states.expanded),
        opacity: 0,
        y      : 22,
      }, contentStart);
      tl.to(portrait, {
        opacity : 1,
        y       : 0,
        duration: 0.54 * speed,
        ease    : 'power3.out',
      }, contentStart + 0.08 * speed);
    }
    if (description) {
      tl.set(description, {
        ...this.getAboutDescriptionPlacement(box, states.expanded),
        opacity      : 0,
        y            : 26,
        pointerEvents: 'none',
      }, contentStart);
      tl.to(description, {
        opacity      : 1,
        y            : 0,
        pointerEvents: 'auto',
        duration     : 0.62 * speed,
        ease         : 'power3.out',
      }, contentStart + 0.16 * speed);
    }
    if (toggle) {
      tl.set(toggle, {
        ...this.getAboutTogglePlacement(box, states.expanded),
        pointerEvents: 'auto',
      }, contentStart + 0.42 * speed);
      tl.to(toggle, {
        autoAlpha: 1,
        scale    : 1,
        duration : 0.24 * speed,
        ease     : 'power2.out',
      }, contentStart + 0.42 * speed);
    }

    return tl;
  }

  private getAboutPlatformStates(box: HTMLElement, _labelInner: HTMLElement | null) {
    const boxRect      = box.getBoundingClientRect();
    const compactPadX  = Math.min(Math.max(window.innerWidth * 0.03, 26), 62);
    const compactPadY  = Math.min(Math.max(window.innerHeight * 0.024, 22), 44);
    const safeWidth    = Math.max(0, boxRect.width - 32);
    const safeHeight   = Math.max(0, boxRect.height - 32);

    // Derive from boxRect proportions — never read from a possibly-hidden
    // labelInner whose getBoundingClientRect() returns wrong values when the
    // element has opacity:0 / a y-transform applied.
    const labelWidth   = Math.min(boxRect.width  * 0.64, 960);
    const labelHeight  = Math.min(boxRect.height * 0.22, 220);

    const compactWidth   = Math.min(safeWidth,  labelWidth  + compactPadX * 2);
    const compactHeight  = Math.min(safeHeight, labelHeight + compactPadY * 2);
    const expandedInsetX = Math.min(Math.max(window.innerWidth  * 0.035, 12), 68);
    const expandedInsetY = Math.min(Math.max(window.innerHeight * 0.05, 36), 62);

    return {
      compact: {
        left        : '50%',
        top         : '50%',
        right       : 'auto',
        bottom      : 'auto',
        xPercent    : -50,
        yPercent    : -50,
        width       : compactWidth,
        height      : compactHeight,
        clipPath    : 'none',
        borderRadius: 24,
        transformOrigin: '50% 50%',
      },
      expanded: {
        left        : '50%',
        top         : '50%',
        right       : 'auto',
        bottom      : 'auto',
        xPercent    : -50,
        yPercent    : -50,
        width       : Math.max(0, boxRect.width - expandedInsetX * 2),
        height      : Math.max(0, boxRect.height - expandedInsetY * 2),
        clipPath    : 'none',
        borderRadius: 24,
        transformOrigin: '50% 50%',
      },
      fullscreen: {
        left        : '50%',
        top         : '50%',
        right       : 'auto',
        bottom      : 'auto',
        xPercent    : -50,
        yPercent    : -50,
        width       : Math.max(0, boxRect.width),
        height      : Math.max(0, boxRect.height),
        clipPath    : 'none',
        borderRadius: 0,
        transformOrigin: '50% 50%',
      },
    };
  }

  private getAboutTogglePlacement(
    _box: HTMLElement,
    _panelState: { width: number; height: number }
  ): { top: number; right: number } {
    const inset = window.innerWidth <= 700 ? 14 : 18;
    return {
      top  : Math.max(12, inset),
      right: Math.max(12, inset),
    };
  }

  private getAboutCornerMarkerPlacement(
    _box: HTMLElement,
    panelState: { width: number; height: number }
  ): { top: number; left: number; width: number } {
    const isMobile = window.innerWidth <= 760;
    const clamp = (value: number, min: number, max: number): number =>
      Math.min(Math.max(value, min), max);

    const inset = isMobile
      ? clamp(panelState.width * 0.065, 18, 24)
      : clamp(panelState.width * 0.065, 34, 120);
    const topInset = isMobile
      ? clamp(panelState.height * 0.04, 18, 28)
      : clamp(panelState.height * 0.047, 26, 42);
    const width = isMobile
      ? Math.max(180, panelState.width - inset * 2)
      : clamp(panelState.width * 0.245, 260, 430);

    return {
      top  : Math.max(18, topInset),
      left : Math.max(18, inset),
      width,
    };
  }

  private getAboutProgressRailPlacement(
    _box: HTMLElement,
    panelState: { width: number; height: number }
  ): { top: number; right: number; height: number } {
    const isMobile = window.innerWidth <= 760;
    const clamp = (value: number, min: number, max: number): number =>
      Math.min(Math.max(value, min), max);

    const rightInset = isMobile
      ? clamp(panelState.width * 0.035, 12, 18)
      : clamp(panelState.width * 0.038, 26, 54);
    const topInset = isMobile
      ? clamp(panelState.height * 0.24, 118, 170)
      : clamp(panelState.height * 0.28, 156, 230);
    const height = isMobile
      ? clamp(panelState.height * 0.4, 180, 260)
      : clamp(panelState.height * 0.48, 230, 390);

    return {
      top   : Math.max(24, topInset),
      right : Math.max(12, rightInset),
      height,
    };
  }

  private getAboutPortraitPlacement(
    _box: HTMLElement,
    panelState: { width: number; height: number }
  ): { width: number; maxHeight: number } {
    const isMobile = window.innerWidth <= 900;

    if (isMobile) {
      return {
        width    : Math.min(panelState.width * 0.72, 430),
        maxHeight: Math.min(panelState.height * 0.46, 500),
      };
    }

    return {
      width    : Math.min(panelState.width * 0.36, panelState.height * 0.74, 560),
      maxHeight: Math.min(panelState.height * 0.86, 760),
    };
  }

  private getAboutDescriptionPlacement(
    _box: HTMLElement,
    panelState: { width: number; height: number }
  ): {
    left: number;
    top: number;
    width: number;
    maxHeight: number;
    '--about-pinned-panel-height': string;
    '--about-pinned-sticky-top': string;
  } {
    const isMobile = window.innerWidth <= 900;

    const padX = isMobile
      ? Math.max(18, panelState.width * 0.055)
      : Math.min(Math.max(panelState.width * 0.055, 44), 78);
    const topPad = isMobile
      ? Math.max(36, panelState.height * 0.055)
      : Math.max(64, panelState.height * 0.11);
    const bottomPad = isMobile
      ? Math.max(28, panelState.height * 0.05)
      : 0;
    const maxHeight = Math.max(320, panelState.height - topPad - bottomPad);
    const pinnedPanelHeight = `${maxHeight}px`;
    const pinnedStickyTop = isMobile
      ? '0px'
      : '0px';

    if (!isMobile) {
      return {
        left     : 0,
        top      : topPad,
        width    : Math.max(320, panelState.width),
        maxHeight,
        '--about-pinned-panel-height': pinnedPanelHeight,
        '--about-pinned-sticky-top'  : pinnedStickyTop,
      };
    }

    return {
      left     : padX,
      top      : topPad,
      width    : Math.max(260, panelState.width - padX * 2),
      maxHeight,
      '--about-pinned-panel-height': pinnedPanelHeight,
      '--about-pinned-sticky-top'  : pinnedStickyTop,
    };
  }


  // ---------------------------------------------------------------------------
  // Work — horizontal sequence isolated inside the vertical page
  // ---------------------------------------------------------------------------

  private setupWorkHorizontalScroll(): void {
    const section = document.querySelector<HTMLElement>('.work-horizontal-section');
    const viewport = section?.querySelector<HTMLElement>('.work-horizontal-viewport') ?? null;
    const track = viewport?.querySelector<HTMLElement>('.work-horizontal-track') ?? null;
    const panels = track
      ? Array.from(track.querySelectorAll<HTMLElement>('.work-horizontal-panel'))
      : [];
    const title = track?.querySelector<HTMLElement>('.work-horizontal-title') ?? null;
    const servicesIndex = track?.querySelector<HTMLElement>('.work-services-index') ?? null;
    const scrollyLines = track
      ? Array.from(track.querySelectorAll<HTMLElement>('.work-scrolly-line'))
      : [];
    const scrollNote = track?.querySelector<HTMLElement>('.work-services-scroll-note') ?? null;
    const experienceIndex = track?.querySelector<HTMLElement>('.work-experience-index') ?? null;
    const experienceHeading = track?.querySelector<HTMLElement>('.work-experience-heading') ?? null;
    const experienceBranches = track
      ? Array.from(track.querySelectorAll<HTMLElement>('.work-experience-branch'))
      : [];
    const experienceCards = track
      ? Array.from(track.querySelectorAll<HTMLElement>('.work-experience-card'))
      : [];
    const processHeading = track?.querySelector<HTMLElement>('.work-process-heading') ?? null;
    const techStackCards = track
      ? Array.from(track.querySelectorAll<HTMLElement>('.tech-stack-card'))
      : [];
    const techStackMarquees = track
      ? Array.from(track.querySelectorAll<HTMLElement>('.tech-stack-marquee'))
      : [];

    if (!section || !viewport || !track || panels.length < 2) return;

    const getPanelOffset = (index: number): number =>
      Math.max(1, panels[Math.min(index, panels.length - 1)]?.offsetLeft ?? 1);

    const getTravelDistance = (): number => getPanelOffset(panels.length - 1);

    const reducedMotion = this.prefersReducedMotion();

    gsap.set(scrollyLines, {
      autoAlpha: reducedMotion ? 1 : 0,
      y: reducedMotion ? 0 : this.motion.distance.reveal,
    });
    if (servicesIndex) gsap.set(servicesIndex, { autoAlpha: reducedMotion ? 1 : 0, x: reducedMotion ? 0 : -16 });
    if (scrollNote) gsap.set(scrollNote, { autoAlpha: reducedMotion ? 0.42 : 0, y: reducedMotion ? 0 : 8 });
    if (experienceIndex) gsap.set(experienceIndex, { autoAlpha: reducedMotion ? 1 : 0, x: reducedMotion ? 0 : -14 });
    if (experienceHeading) gsap.set(experienceHeading, { autoAlpha: reducedMotion ? 1 : 0, x: reducedMotion ? 0 : -28 });
    gsap.set(experienceBranches, { scaleY: reducedMotion ? 1 : 0 });
    gsap.set(experienceCards, { autoAlpha: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 18 });
    if (processHeading) gsap.set(processHeading, { autoAlpha: reducedMotion ? 1 : 0, x: reducedMotion ? 0 : -30 });
    gsap.set(techStackCards, {
      autoAlpha: reducedMotion ? 1 : 0,
      y: reducedMotion ? 0 : this.motion.distance.card,
    });
    gsap.set(techStackMarquees, { autoAlpha: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : 16 });

    let processCardsRevealed = reducedMotion;
    const processRevealTimeline = !reducedMotion
      ? this.track(gsap.timeline({
          paused  : true,
          defaults: {
            overwrite: 'auto',
          },
        })
          .to(techStackCards, {
            autoAlpha: 1,
            y         : 0,
            duration  : this.motion.duration.reveal,
            stagger   : this.motion.stagger.normal,
            ease      : this.motion.ease.enter,
          }, 0)
          .to(techStackMarquees, {
            autoAlpha: 1,
            y        : 0,
            duration : 0.42,
            stagger  : 0.07,
            ease     : 'power2.out',
          }, 0.34))
      : null;

    const resetProcessCards = (): void => {
      if (reducedMotion || !processCardsRevealed) return;

      processCardsRevealed = false;
      processRevealTimeline?.pause(0);
      gsap.set(techStackCards, { autoAlpha: 0, y: this.motion.distance.card });
      gsap.set(techStackMarquees, { autoAlpha: 0, y: 16 });
    };

    const revealProcessCards = (): void => {
      if (reducedMotion || processCardsRevealed) return;

      processCardsRevealed = true;
      processRevealTimeline?.restart();
    };

    let processLayerActive = false;
    const timeline = this.track(gsap.timeline({
      scrollTrigger: {
        id                 : 'work-horizontal-scroll',
        trigger            : section,
        start              : 'top top',
        end                : () => `+=${Math.max(getTravelDistance(), window.innerHeight * 2.8)}`,
        pin                : true,
        scrub              : reducedMotion ? true : this.perfLite ? 0.35 : this.motion.scrub.work,
        anticipatePin      : 1,
        invalidateOnRefresh: true,
        onUpdate           : (self) => {
          const currentX = Math.abs(Number(gsap.getProperty(track, 'x')) || 0);
          const processRevealX = Math.max(
            getPanelOffset(Math.max(0, panels.length - 2)),
            getTravelDistance() * 0.78
          );
          const processResetX = Math.max(0, processRevealX - Math.max(window.innerWidth * 0.24, 220));
          const isProcessActive = self.isActive && currentX >= processRevealX;

          if (isProcessActive !== processLayerActive) {
            processLayerActive = isProcessActive;
            section.classList.toggle('is-process-active', isProcessActive);
          }

          if (isProcessActive) {
            revealProcessCards();
          } else if (currentX < processResetX) {
            resetProcessCards();
          }
        },
      },
    }));

    timeline
      .to(title, {
        autoAlpha: 0,
        scale    : 0.94,
        duration : reducedMotion ? 0.08 : 0.24,
        ease     : 'power2.in',
      }, 0.02)
      .to(track, {
        x       : () => -getPanelOffset(1),
        duration: reducedMotion ? 0.42 : 0.38,
        ease    : reducedMotion ? 'none' : 'power3.inOut',
      }, 0.04);

    if (servicesIndex) {
      timeline.to(servicesIndex, { autoAlpha: 1, x: 0, duration: 0.18, ease: 'power2.out' }, 0.26);
    }
    if (!reducedMotion && scrollyLines.length > 0) {
      // Scrollytelling beats: one line reveals, holds, then hands off to the
      // next — each beat is an absolute time slot on the scrubbed timeline so
      // scroll position maps directly to "which line is showing" rather than
      // playing on a clock.
      const beatStart = 0.46;
      const beatSpacing = 0.23;

      scrollyLines.forEach((line, index) => {
        const previousLine = scrollyLines[index - 1];
        const beatTime = beatStart + index * beatSpacing;

        if (previousLine) {
          timeline.to(previousLine, {
            autoAlpha: 0,
            y        : -18,
            duration : 0.16,
            ease     : 'power2.in',
          }, beatTime);
        }

        timeline.to(line, {
          autoAlpha: 1,
          y        : 0,
          duration : 0.22,
          ease     : 'power2.out',
        }, beatTime);
      });
    }
    if (scrollNote) {
      timeline.to(scrollNote, { autoAlpha: 0.42, y: 0, duration: 0.18, ease: 'power2.out' }, reducedMotion ? 0.48 : 1.31);
    }

    if (scrollNote) {
      timeline.to(scrollNote, { autoAlpha: 0, y: -6, duration: 0.14, ease: 'power1.in' }, reducedMotion ? 0.72 : 1.46);
    }
    timeline.to(track, {
      x       : () => -getPanelOffset(2),
      duration: reducedMotion ? 0.38 : 0.46,
      ease    : reducedMotion ? 'none' : 'power3.inOut',
    }, reducedMotion ? 0.76 : 1.48);

    if (experienceIndex) {
      timeline.to(experienceIndex, { autoAlpha: 1, x: 0, duration: 0.18, ease: 'power2.out' }, reducedMotion ? 0.98 : 1.78);
    }
    if (experienceHeading) {
      timeline.to(experienceHeading, { autoAlpha: 1, x: 0, duration: 0.3, ease: 'power3.out' }, reducedMotion ? 0.98 : 1.79);
    }
    if (!reducedMotion) {
      timeline
        .to(experienceBranches, {
          scaleY  : 1,
          duration: 0.46,
          stagger : 0.085,
          ease    : 'power2.inOut',
        }, 1.92)
        .to(experienceCards, {
          autoAlpha: 1,
          y        : 0,
          duration : 0.34,
          stagger  : 0.1,
          ease     : 'power2.out',
        }, 2.43);
    }

    timeline.to(track, {
      x       : () => -getTravelDistance(),
      duration: reducedMotion ? 0.4 : 0.5,
      ease    : reducedMotion ? 'none' : 'power3.inOut',
    }, reducedMotion ? 1.32 : 3.08);

    if (processHeading) {
      timeline.to(processHeading, {
        autoAlpha: 1,
        x        : 0,
        duration : reducedMotion ? 0.16 : 0.34,
        ease     : 'power3.out',
      }, reducedMotion ? 1.52 : 3.4);
    }
    timeline.to({}, { duration: reducedMotion ? 0.12 : 0.28 });

    const titleTween = title
      ? this.track(gsap.fromTo(
          title,
          {
            autoAlpha: 0,
            y        : this.motion.distance.card,
            scale    : 0.94,
          },
          {
            autoAlpha: 1,
            y        : 0,
            scale    : 1,
            ease     : 'none',
            scrollTrigger: {
              id     : 'work-title-reveal',
              trigger: section,
              start  : 'top 82%',
              end    : 'top 46%',
              scrub  : reducedMotion ? true : this.perfLite ? 0.25 : this.motion.scrub.reveal,
            },
          }
        ))
      : null;

    this.cleanupFns.push(() => {
      try { ScrollTrigger.getById('work-horizontal-scroll')?.kill(); } catch (_) {}
      try { ScrollTrigger.getById('work-title-reveal')?.kill(); } catch (_) {}
      try { timeline.kill(); } catch (_) {}
      try { titleTween?.kill(); } catch (_) {}
      try { processRevealTimeline?.kill(); } catch (_) {}
      section.classList.remove('is-process-active');
      gsap.set([
        track,
        title,
        servicesIndex,
        scrollNote,
        experienceIndex,
        experienceHeading,
        processHeading,
        ...scrollyLines,
        ...experienceBranches,
        ...experienceCards,
        ...techStackCards,
        ...techStackMarquees,
      ], { clearProps: 'all' });
    });
  }

  // ---------------------------------------------------------------------------
  // Nav smooth scroll
  // ---------------------------------------------------------------------------

  private setupThemeToggle(): void {
    const pageCanvas = document.querySelector<HTMLElement>('.page-canvas');
    const toggle = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');

    if (!pageCanvas || !toggle) return;

    const getStoredTheme = (): SiteTheme | null => {
      try {
        const storedTheme = window.localStorage.getItem(this.themeStorageKey);
        return storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : null;
      } catch (_) {
        return null;
      }
    };

    const saveTheme = (theme: SiteTheme): void => {
      try {
        window.localStorage.setItem(this.themeStorageKey, theme);
      } catch (_) {}
    };

    const applyTheme = (theme: SiteTheme, persist = false): void => {
      pageCanvas.dataset['theme'] = theme;
      document.documentElement.dataset['theme'] = theme;

      const isLight = theme === 'light';
      const nextTheme = isLight ? 'dark' : 'light';
      const label = `Switch to ${nextTheme} theme`;

      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('aria-pressed', String(isLight));
      toggle.setAttribute('title', label);

      if (persist) saveTheme(theme);

      window.requestAnimationFrame(() => {
        try { ScrollTrigger.refresh(); } catch (_) {}
      });
    };

    const onToggleTheme = (): void => {
      const currentTheme: SiteTheme = pageCanvas.dataset['theme'] === 'light' ? 'light' : 'dark';
      applyTheme(currentTheme === 'light' ? 'dark' : 'light', true);
    };

    applyTheme(getStoredTheme() ?? 'dark');
    toggle.addEventListener('click', onToggleTheme);

    this.cleanupFns.push(() => {
      toggle.removeEventListener('click', onToggleTheme);
      delete document.documentElement.dataset['theme'];
    });
  }

  private setupNavScrolling(): void {
    const pageCanvas = document.querySelector<HTMLElement>('.page-canvas');
    const heroNav = document.querySelector<HTMLElement>('.hero-nav');
    const navLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('.nav-link[data-section]')
    );
    const navSections = navLinks
      .map(link => link.dataset['section'])
      .filter((section): section is string => !!section);
    let navSectionOffsets: Array<{ section: string; top: number }> = [];
    let navOffsetsDirty = true;
    const contactExpander = document.querySelector<HTMLElement>('.contact-expander');
    const contactToggle = contactExpander?.querySelector<HTMLButtonElement>('.contact-toggle') ?? null;
    const contactPopup = document.querySelector<HTMLElement>('.contact-popup');
    const contactPopupFocusable = contactPopup
      ? Array.from(
          contactPopup.querySelectorAll<HTMLElement>(
            'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
          )
        )
      : [];
    const contactPopupCloseButtons = contactPopup
      ? Array.from(contactPopup.querySelectorAll<HTMLElement>('[data-contact-popup-close]'))
      : [];
    const notesToggle = document.querySelector<HTMLButtonElement>('.notes-widget-toggle');
    let navUpdateFrame: number | null = null;
    let routeTransition: HTMLElement | null = null;
    let routeTransitionTimeline: gsap.core.Timeline | null = null;
    let notesPillPassedY: number | null = null;

    const setNotesPillVisible = (isVisible: boolean): void => {
      if (!notesToggle) return;
      notesToggle.hidden = !isVisible;
      notesToggle.style.display = isVisible ? '' : 'none';
    };

    const refreshNotesPillThreshold = (): void => {
      if (!notesToggle) {
        notesPillPassedY = null;
        return;
      }

      const wasHidden = notesToggle.hidden;
      const previousDisplay = notesToggle.style.display;

      if (wasHidden || previousDisplay === 'none') {
        notesToggle.hidden = false;
        notesToggle.style.display = '';
      }

      const rect = notesToggle.getBoundingClientRect();
      notesPillPassedY = rect.width > 0 && rect.height > 0
        ? rect.bottom + (window.scrollY || window.pageYOffset)
        : null;

      notesToggle.hidden = wasHidden;
      notesToggle.style.display = previousDisplay;
    };

    const refreshNavSectionOffsets = (): void => {
      const scrollY = window.scrollY || window.pageYOffset;
      navSectionOffsets = navSections.flatMap((section) => {
        const target = document.getElementById(section);
        return target
          ? [{ section, top: target.getBoundingClientRect().top + scrollY }]
          : [];
      });
      refreshNotesPillThreshold();
      navOffsetsDirty = false;
    };

    const setActiveLink = (section: string): void => {
      navLinks.forEach((link) => {
        link.classList.toggle('active', link.dataset['section'] === section);
      });
    };

    const setContactOpen = (isOpen: boolean): void => {
      if (!contactExpander || !contactToggle || !contactPopup) return;

      const wasOpen = contactPopup.classList.contains('is-open');
      contactExpander.classList.toggle('is-open', isOpen);
      contactPopup.classList.toggle('is-open', isOpen);
      contactToggle.setAttribute('aria-expanded', String(isOpen));
      contactToggle.setAttribute('aria-label', isOpen ? 'Close quick links' : 'Open quick links');
      contactPopup.setAttribute('aria-hidden', String(!isOpen));
      document.body.style.overflow = isOpen ? 'hidden' : '';

      if (isOpen) {
        window.setTimeout(() => {
          contactPopup.querySelector<HTMLElement>('.contact-popup-links a')?.focus();
        }, 120);
      } else if (wasOpen) {
        contactToggle.focus();
      }
    };

    const updateActiveLink = (): void => {
      const scrollY = window.scrollY || window.pageYOffset;
      const activationY = scrollY + window.innerHeight * 0.36;
      let activeSection = 'home';

      if (navOffsetsDirty) refreshNavSectionOffsets();
      navSectionOffsets.forEach(({ section, top }) => {
        if (activationY >= top) activeSection = section;
      });

      setActiveLink(activeSection);
      const firstPostHomeTop = navSectionOffsets
        .filter(({ section }) => section !== 'home')
        .reduce((minTop, { top }) => Math.min(minTop, top), Number.POSITIVE_INFINITY);
      const hasPassedHomePill = notesPillPassedY !== null
        ? scrollY >= notesPillPassedY - 1
        : null;
      const hasPassedHome = hasPassedHomePill ?? (Number.isFinite(firstPostHomeTop)
        ? scrollY >= firstPostHomeTop - 1
        : activeSection !== 'home');
      const notchThreshold = Math.min(64, Math.max(24, window.innerHeight * 0.05));
      pageCanvas?.classList.toggle('has-side-wall-notch', hasPassedHome);
      setNotesPillVisible(!hasPassedHome);
      heroNav?.classList.toggle(
        'is-scrolled',
        scrollY > notchThreshold || activeSection !== 'home'
      );
    };

    const requestNavUpdate = (): void => {
      if (navUpdateFrame !== null) return;

      navUpdateFrame = window.requestAnimationFrame(() => {
        navUpdateFrame = null;
        updateActiveLink();
      });
    };

    const invalidateNavOffsets = (): void => {
      navOffsetsDirty = true;
      requestNavUpdate();
    };

    const getRouteTransition = (): HTMLElement => {
      if (routeTransition) return routeTransition;

      routeTransition = document.createElement('div');
      routeTransition.className = 'page-route-transition';
      routeTransition.setAttribute('aria-hidden', 'true');
      routeTransition.innerHTML = '<span class="page-route-transition-label"></span>';
      document.body.appendChild(routeTransition);
      return routeTransition;
    };

    const playAboutMoreNavTransition = (section: string): void => {
      const transition = getRouteTransition();
      const label = transition.querySelector<HTMLElement>('.page-route-transition-label');
      const reducedMotion = this.prefersReducedMotion();

      try { routeTransitionTimeline?.kill(); } catch (_) {}
      try { this.pageScrollTween?.kill(); } catch (_) {}
      this.pageScrollTween = null;

      if (label) label.textContent = section.toUpperCase();
      pageCanvas?.classList.add('is-route-wrapping');
      gsap.set(transition, { autoAlpha: 1, yPercent: 100 });
      if (label) gsap.set(label, { autoAlpha: 0, y: 20 });

      routeTransitionTimeline = gsap.timeline({
        defaults: { ease: 'power3.inOut' },
        onComplete: () => {
          pageCanvas?.classList.remove('is-route-wrapping');
          gsap.set(transition, { autoAlpha: 0, yPercent: 100 });
          routeTransitionTimeline = null;
        },
      });

      routeTransitionTimeline
        .to(transition, { yPercent: 0, duration: reducedMotion ? 0.01 : 0.52 }, 0)
        .to(label, { autoAlpha: 1, y: 0, duration: reducedMotion ? 0.01 : 0.22, ease: 'power2.out' }, reducedMotion ? 0 : 0.18)
        .add(() => {
          window.dispatchEvent(new CustomEvent('about-more:close', { detail: { restoreFocus: false } }));
          this.scrollToPageSection(section, 'auto');
          navOffsetsDirty = true;
          setActiveLink(section);
          setNotesPillVisible(section === 'home');
          updateActiveLink();
        }, reducedMotion ? 0.02 : 0.58)
        .to(label, { autoAlpha: 0, y: -20, duration: reducedMotion ? 0.01 : 0.18, ease: 'power2.in' }, reducedMotion ? 0.03 : 0.78)
        .to(transition, { yPercent: -100, duration: reducedMotion ? 0.01 : 0.5 }, reducedMotion ? 0.04 : 0.78);
    };

    const onClick = (e: Event): void => {
      const link    = e.currentTarget as HTMLAnchorElement;
      const section = link.dataset['section'];
      if (!section) return;

      const target = document.getElementById(section);
      if (!target) return;

      e.preventDefault();
      setActiveLink(section);
      setNotesPillVisible(section === 'home');
      setContactOpen(false);
      if (pageCanvas?.classList.contains('is-about-more-open')) {
        playAboutMoreNavTransition(section);
        return;
      }
      this.scrollToPageSection(section, 'smooth');
    };

    const onContactToggleClick = (e: Event): void => {
      e.preventDefault();
      const isOpen = !contactPopup?.classList.contains('is-open');
      setContactOpen(isOpen);
    };

    const onContactPopupClose = (e: Event): void => {
      e.preventDefault();
      setContactOpen(false);
    };

    const onContactPopupKeydown = (event: KeyboardEvent): void => {
      if (!contactPopup?.classList.contains('is-open')) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        setContactOpen(false);
        return;
      }

      if (event.key !== 'Tab' || contactPopupFocusable.length === 0) return;

      const first = contactPopupFocusable[0];
      const last = contactPopupFocusable[contactPopupFocusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    navLinks.forEach(link => link.addEventListener('click', onClick));
    window.addEventListener('scroll', requestNavUpdate, { passive: true });
    window.addEventListener('resize', invalidateNavOffsets, { passive: true });
    ScrollTrigger.addEventListener('refresh', invalidateNavOffsets);
    if (contactToggle) contactToggle.addEventListener('click', onContactToggleClick);
    contactPopupCloseButtons.forEach(button => button.addEventListener('click', onContactPopupClose));
    document.addEventListener('keydown', onContactPopupKeydown);
    updateActiveLink();

    this.cleanupFns.push(() => {
      navLinks.forEach(link => link.removeEventListener('click', onClick));
      window.removeEventListener('scroll', requestNavUpdate);
      window.removeEventListener('resize', invalidateNavOffsets);
      ScrollTrigger.removeEventListener('refresh', invalidateNavOffsets);
      if (navUpdateFrame !== null) window.cancelAnimationFrame(navUpdateFrame);
      if (contactToggle) contactToggle.removeEventListener('click', onContactToggleClick);
      contactPopupCloseButtons.forEach(button => button.removeEventListener('click', onContactPopupClose));
      document.removeEventListener('keydown', onContactPopupKeydown);
      pageCanvas?.classList.remove('has-side-wall-notch');
      pageCanvas?.classList.remove('is-route-wrapping');
      setNotesPillVisible(true);
      document.body.style.overflow = '';
      try { routeTransitionTimeline?.kill(); } catch (_) {}
      routeTransitionTimeline = null;
      routeTransition?.remove();
      routeTransition = null;
    });
  }

  private setupContactForms(): void {
    const forms = Array.from(
      document.querySelectorAll<HTMLFormElement>('form[data-contact-form]')
    );

    if (forms.length === 0) return;

    const submitForm = async (form: HTMLFormElement): Promise<void> => {
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      const status = form.querySelector<HTMLElement>('.contact-form-status');
      if (!button || form.dataset['submitting'] === 'true') return;
      if (!form.reportValidity()) return;

      const formData = new FormData(form);
      const payload = {
        name   : String(formData.get('name') ?? ''),
        email  : String(formData.get('email') ?? ''),
        message: String(formData.get('message') ?? ''),
        website: String(formData.get('website') ?? ''),
      };
      const originalLabel = button.textContent ?? 'Submit';
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15_000);

      form.dataset['submitting'] = 'true';
      form.setAttribute('aria-busy', 'true');
      button.disabled = true;
      button.textContent = 'Sending…';
      status?.classList.remove('is-success', 'is-error');
      if (status) status.textContent = '';

      try {
        const response = await fetch('/api/contact', {
          method : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify(payload),
          signal : controller.signal,
        });
        const responseType = response.headers.get('content-type') ?? '';
        const result = responseType.includes('application/json')
          ? await response.json().catch(() => ({} as { error?: string }))
          : {};
        const responsePayload = result as {
          error?: string;
        };

        if (!response.ok) {
          const fallback = response.status === 504 || response.status === 502
            ? 'The email server is not running. Restart the app with npm start.'
            : `Your message could not be sent (error ${response.status}).`;
          throw new Error(responsePayload.error?.trim() || fallback);
        }

        form.reset();
        status?.classList.add('is-success');
        if (status) status.textContent = 'Message sent. I’ll get back to you soon.';
      } catch (error) {
        const message = error instanceof DOMException && error.name === 'AbortError'
          ? 'Sending took too long. Please try again.'
          : error instanceof Error
            ? error.message
            : 'Your message could not be sent.';
        status?.classList.add('is-error');
        if (status) status.textContent = message;
      } finally {
        window.clearTimeout(timeout);
        delete form.dataset['submitting'];
        form.removeAttribute('aria-busy');
        button.disabled = false;
        button.textContent = originalLabel;
      }
    };

    const handlers = forms.map((form) => {
      const onSubmit = (event: SubmitEvent): void => {
        event.preventDefault();
        void submitForm(form);
      };
      form.addEventListener('submit', onSubmit);
      return { form, onSubmit };
    });

    this.cleanupFns.push(() => {
      handlers.forEach(({ form, onSubmit }) => {
        form.removeEventListener('submit', onSubmit);
      });
    });
  }

  public scrollToNextSection(): void {
    this.scrollToPageSection('about', 'smooth');
  }

  private scrollToPageSection(section: string, behavior: ScrollBehavior = 'smooth'): void {
    const target = document.getElementById(section);
    if (!target) return;

    const currentY = window.scrollY || window.pageYOffset;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const targetY = Math.min(
      Math.max(0, target.getBoundingClientRect().top + currentY),
      maxScroll
    );

    try { this.pageScrollTween?.kill(); } catch (_) {}

    if (behavior === 'auto' || this.prefersReducedMotion()) {
      window.scrollTo({ top: targetY, left: 0, behavior: 'auto' });
      return;
    }

    const pageCanvas = document.querySelector<HTMLElement>('.page-canvas');
    pageCanvas?.classList.add('is-section-transitioning');

    this.pageScrollTween = this.track(gsap.to(window, {
      duration: this.getPageScrollDuration(Math.abs(targetY - currentY)),
      ease: this.motionEase,
      scrollTo: {
        y: targetY,
        autoKill: true,
      },
      onComplete: () => {
        pageCanvas?.classList.remove('is-section-transitioning');
        this.pageScrollTween = null;
      },
      onInterrupt: () => {
        pageCanvas?.classList.remove('is-section-transitioning');
        this.pageScrollTween = null;
      },
    }));
  }

  private getPageScrollDuration(distance: number): number {
    if (this.perfLite) return this.motion.duration.normal;

    const viewportRatio = distance / Math.max(window.innerHeight, 1);
    return gsap.utils.clamp(0.58, 1.05, 0.52 + viewportRatio * 0.14);
  }

  // ---------------------------------------------------------------------------
  // Skills runway entrance
  // ---------------------------------------------------------------------------

  private setupSkillsReveal(): void {
    const section = document.querySelector<HTMLElement>('.skills-runway-section');
    if (!section || this.prefersReducedMotion()) return;

    const eyebrow = section.querySelector<HTMLElement>('.skills-runway-eyebrow');
    const title = section.querySelector<HTMLElement>('.skills-runway-title');
    const status = section.querySelector<HTMLElement>('.skills-runway-status');
    const years = Array.from(section.querySelectorAll<HTMLElement>('.skills-year'));
    const rows = Array.from(section.querySelectorAll<HTMLElement>('.skills-runway-row'));
    const names = rows
      .map((row) => row.querySelector<HTMLElement>('.skills-row-name'))
      .filter((element): element is HTMLElement => element !== null);
    const tracks = rows
      .map((row) => row.querySelector<HTMLElement>('.skills-bar'))
      .filter((element): element is HTMLElement => element !== null);
    const fills = rows
      .map((row) => row.querySelector<HTMLElement>('.skills-bar-fill'))
      .filter((element): element is HTMLElement => element !== null);
    const levelLabels = rows
      .map((row) => row.querySelector<HTMLElement>('.skills-row-years'))
      .filter((element): element is HTMLElement => element !== null);

    if (!title || rows.length === 0) return;

    const supportingTitle = [eyebrow, status].filter(
      (element): element is HTMLElement => element !== null
    );

    gsap.set(title, { autoAlpha: 0, y: 16 });
    gsap.set(supportingTitle, { autoAlpha: 0, y: 7 });
    gsap.set(years, { autoAlpha: 0, y: 6 });
    gsap.set(names, { autoAlpha: 0, x: -10 });
    gsap.set(tracks, {
      autoAlpha: 0,
      scaleX: 0,
      transformOrigin: 'left center',
    });
    gsap.set(levelLabels, { autoAlpha: 0, x: 8 });
    gsap.set(fills, {
      scaleX: 0,
      transformOrigin: 'right center',
    });

    const timeline = gsap.timeline({
      defaults: { overwrite: 'auto' },
      scrollTrigger: {
        id: 'skills-runway-reveal',
        trigger: section,
        start: 'top 78%',
        once: true,
      },
    });

    timeline
      .to(title, {
        autoAlpha: 1,
        y: 0,
        duration: this.motion.duration.normal,
        ease: this.motion.ease.enter,
      })
      .to(supportingTitle, {
        autoAlpha: 1,
        y: 0,
        duration: 0.2,
        stagger: 0.035,
        ease: 'power2.out',
      }, '-=0.15')
      .to(years, {
        autoAlpha: 1,
        y: 0,
        duration: 0.18,
        stagger: 0.02,
        ease: 'power2.out',
      }, '-=0.08')
      .to(names, {
        autoAlpha: 1,
        x: 0,
        duration: 0.24,
        stagger: 0.028,
        ease: 'power2.out',
      })
      .to(tracks, {
        autoAlpha: 1,
        scaleX: 1,
        duration: 0.24,
        stagger: 0.028,
        ease: 'power2.out',
      }, '<')
      .to(levelLabels, {
        autoAlpha: 1,
        x: 0,
        duration: 0.18,
        stagger: 0.022,
        ease: 'power2.out',
      }, '<+0.06')
      .to(fills, {
        scaleX: 1,
        duration: 0.42,
        stagger: 0.032,
        ease: 'power2.inOut',
      }, '>-0.05');

    this.track(timeline);
    this.cleanupFns.push(() => {
      try { ScrollTrigger.getById('skills-runway-reveal')?.kill(); } catch (_) {}
    });
  }

  // ---------------------------------------------------------------------------
  // Contact — scroll-triggered reveal for the form panel and social rail.
  // Every other section on the page animates in on scroll; this one was the
  // only exception, appearing instantly.
  // ---------------------------------------------------------------------------

  private setupContactReveal(): void {
    const section = document.querySelector<HTMLElement>('.contact-section');
    if (!section || this.prefersReducedMotion()) return;

    const socialLinks = Array.from(section.querySelectorAll<HTMLElement>('.contact-social-rail a'));
    const formPanel = section.querySelector<HTMLElement>('.contact-form-panel');
    const formFields = formPanel
      ? Array.from(
          formPanel.querySelectorAll<HTMLElement>(':scope > label:not(.contact-honeypot), :scope > button')
        )
      : [];

    if (!formPanel && socialLinks.length === 0) return;

    if (formPanel) gsap.set(formPanel, { autoAlpha: 0, y: 28 });
    gsap.set(formFields, { autoAlpha: 0, y: 14 });
    gsap.set(socialLinks, { autoAlpha: 0, y: 14 });

    const timeline = gsap.timeline({
      defaults: { overwrite: 'auto' },
      scrollTrigger: {
        id: 'contact-section-reveal',
        trigger: section,
        start: 'top 78%',
        once: true,
      },
    });

    if (formPanel) {
      timeline.to(formPanel, {
        autoAlpha: 1,
        y: 0,
        duration: 0.6,
        ease: 'power3.out',
      });
    }

    if (formFields.length > 0) {
      timeline.to(
        formFields,
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.42,
          stagger: 0.06,
          ease: 'power2.out',
        },
        formPanel ? '-=0.3' : 0
      );
    }

    if (socialLinks.length > 0) {
      timeline.to(
        socialLinks,
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.36,
          stagger: 0.05,
          ease: 'power2.out',
        },
        '-=0.2'
      );
    }

    this.track(timeline);
    this.cleanupFns.push(() => {
      try { ScrollTrigger.getById('contact-section-reveal')?.kill(); } catch (_) {}
    });
  }

  private setupContactTypewriter(): void {
    const paragraph = document.querySelector<HTMLElement>('.contact-typewriter');
    if (!paragraph) return;

    const fullText = paragraph.textContent?.trim() ?? '';
    if (!fullText) return;

    if (this.prefersReducedMotion()) {
      paragraph.textContent = fullText;
      return;
    }

    const characters = Array.from(fullText);
    const typeState = { count: 0 };
    let cursorTimer: number | null = null;

    paragraph.textContent = '';
    paragraph.classList.add('contact-typewriter-cursor');

    const tween = gsap.to(typeState, {
      count: characters.length,
      duration: gsap.utils.clamp(0.9, 2.6, characters.length * 0.028),
      ease: 'none',
      onUpdate: () => {
        paragraph.textContent = characters.slice(0, Math.round(typeState.count)).join('');
      },
      onComplete: () => {
        paragraph.textContent = fullText;
        cursorTimer = window.setTimeout(() => {
          cursorTimer = null;
          paragraph.classList.remove('contact-typewriter-cursor');
        }, 650);
      },
      scrollTrigger: {
        id: 'contact-typewriter',
        trigger: paragraph,
        start: 'top 85%',
        once: true,
      },
    });

    this.track(tween);
    this.cleanupFns.push(() => {
      try { ScrollTrigger.getById('contact-typewriter')?.kill(); } catch (_) {}
      if (cursorTimer !== null) window.clearTimeout(cursorTimer);
    });
  }

  private startAboutProfileTypewriter(): void {
    const paragraph = document.querySelector<HTMLElement>('.about-profile-note');
    if (!paragraph || this.prefersReducedMotion()) return;

    const fullText = paragraph.textContent?.trim() ?? '';
    if (!fullText) return;

    const characters = Array.from(fullText);
    const typeState = { count: 0 };
    paragraph.textContent = '';
    const characterSpans = characters.map((character) => {
      const span = document.createElement('span');
      span.className = 'about-profile-note-character';
      span.textContent = character;
      span.style.visibility = 'hidden';
      paragraph.append(span);
      return span;
    });
    let cursorTimer: number | null = null;

    const tween = gsap.to(typeState, {
      count: characters.length,
      duration: gsap.utils.clamp(1.2, 3.2, characters.length * 0.03),
      ease: 'none',
      onUpdate: () => {
        const typedCount = Math.round(typeState.count);
        characterSpans.forEach((span, index) => {
          span.style.visibility = index < typedCount ? 'visible' : 'hidden';
          span.classList.toggle('is-current', index === typedCount - 1);
        });
      },
      onComplete: () => {
        cursorTimer = window.setTimeout(() => {
          cursorTimer = null;
          paragraph.textContent = fullText;
        }, 700);
      },
    });

    this.track(tween);
    this.cleanupFns.push(() => {
      if (cursorTimer !== null) window.clearTimeout(cursorTimer);
      paragraph.textContent = fullText;
    });
  }

  // ---------------------------------------------------------------------------
  // Site-wide scroll text reveal
  // ---------------------------------------------------------------------------

  private setupScrollTextReveals(): void {
    if (this.prefersReducedMotion()) return;

    const selectors = [
      '.about-corner-marker span',
      '.about-product-card h2',
      '.about-connect-button span',
      '.page-section .section-kicker',
      '.page-section .section-title-row h2',
      '.page-section .section-lede',
      '.contact-info-panel h2',
    ];
    const excludedContexts = [
      '.hero-nav',
      '.landing-loader',
      '.notes-widget',
      '.chatbox',
      '.solari-board',
      '.profession-rotator',
      '.contact-social-rail',
      '.visually-hidden',
    ].join(', ');
    const candidates = selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector))
    );
    const seen = new Set<HTMLElement>();
    const triggerIds: string[] = [];
    let revealIndex = 0;

    this.aboutTextRevealTweens = [];

    candidates.forEach((element) => {
      if (seen.has(element)) return;
      if (!element.textContent?.trim()) return;
      if (element.closest(excludedContexts)) return;

      seen.add(element);
      element.classList.add('site-scroll-text-reveal');

      const isAboutRevealText = !!element.closest('.about-reveal-box');
      const triggerElement = element.closest<HTMLElement>('.about-profile-card') ?? element;
      const triggerId = `site-text-reveal-${revealIndex}`;
      const delay = Math.min((revealIndex % 4) * 0.045, 0.14);

      const tween = gsap.fromTo(
        element,
        {
          autoAlpha: 0,
          y        : this.motion.distance.reveal,
        },
        {
          autoAlpha: 1,
          y        : 0,
          duration : this.motion.duration.reveal,
          delay,
          ease     : this.motion.ease.enter,
          overwrite: 'auto',
          ...(isAboutRevealText
            ? { paused: true }
            : {
                scrollTrigger: {
                  id     : triggerId,
                  trigger: triggerElement,
                  start  : 'top 86%',
                  once   : true,
                },
              }),
        }
      );

      this.track(tween);
      if (isAboutRevealText) {
        this.aboutTextRevealTweens.push(tween);
      } else {
        triggerIds.push(triggerId);
      }
      revealIndex++;
    });

    this.playAboutTextReveals();

    if (triggerIds.length > 0) {
      this.cleanupFns.push(() => {
        triggerIds.forEach((id) => {
          try { ScrollTrigger.getById(id)?.kill(); } catch (_) {}
        });
      });
    }

    this.refreshScrollTextReveals();
  }

  private playAboutTextReveals(): void {
    if (
      this.isDestroyed ||
      this.prefersReducedMotion() ||
      !this.aboutTextRevealReady ||
      this.aboutTextRevealPlayed ||
      this.aboutTextRevealTweens.length === 0
    ) {
      return;
    }

    this.aboutTextRevealPlayed = true;
    this.aboutTextRevealTweens.forEach((tween) => {
      try {
        tween.restart(true, false);
      } catch (_) {
        try { tween.play(0); } catch (_) {}
      }
    });
  }

  private refreshScrollTextReveals(): void {
    if (this.isDestroyed || this.prefersReducedMotion()) return;
    if (this.scrollRefreshFrame !== null) return;

    this.scrollRefreshFrame = window.requestAnimationFrame(() => {
      this.scrollRefreshFrame = null;
      if (this.isDestroyed) return;
      try { ScrollTrigger.refresh(); } catch (_) {}
    });
  }

  // ---------------------------------------------------------------------------
  // Talk widget
  // ---------------------------------------------------------------------------

  private setupNotesWidget(): void {
    const widget = document.querySelector<HTMLElement>('.notes-widget');
    const panel  = document.querySelector<HTMLElement>('.notes-widget-panel');
    const toggle = widget?.querySelector<HTMLButtonElement>('.notes-widget-toggle') ?? null;
    const sideToggle = document.querySelector<HTMLButtonElement>('[data-side-chat-toggle]');
    const closeButton = panel?.querySelector<HTMLButtonElement>('.chatbox-close') ?? null;
    const chatBody = panel?.querySelector<HTMLElement>('.chatbox-body') ?? null;
    const introMessage = panel?.querySelector<HTMLElement>('.chatbox-message--intro') ?? null;
    const chatForm = panel?.querySelector<HTMLFormElement>('.chatbox-input-row') ?? null;
    const chatInput = chatForm?.querySelector<HTMLInputElement>('input') ?? null;
    const chatSubmit = chatForm?.querySelector<HTMLButtonElement>('button[type="submit"]') ?? null;

    if (!widget || !panel || !toggle) return;

    const originalParent = widget.parentNode;
    const originalNextSibling = widget.nextSibling;
    if (widget.parentElement !== document.body) {
      document.body.appendChild(widget);
    }

    this.solariScopeAttr ??= this.getAngularScopeAttribute(widget);

    let isOpen = false;
    let isWaitingForReply = false;
    let hasTypedIntroMessage = false;
    let introTypewriterTimeout = 0;
    let morphTimer = 0;
    let shapeMorphTween: gsap.core.Timeline | null = null;
    const chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const introText = String(introMessage?.textContent ?? '').replace(/\s+/g, ' ').trim();

    if (introMessage && !this.prefersReducedMotion()) {
      introMessage.textContent = '';
    }

    // ---------------------------------------------------------------------
    // Liquid morph — the panel's "closed" shape is computed live from the
    // pill's actual on-screen rect (FLIP), so the panel always grows out of
    // exactly where the pill sits rather than a guessed scale ratio. CSS
    // transitions on both elements are suspended for the duration so they
    // can't fight the per-frame inline styles GSAP is writing.
    // ---------------------------------------------------------------------
    const settleTogglePill = (): void => {
      toggle.style.removeProperty('transition');
      gsap.set(toggle, { clearProps: 'transform,opacity,transformOrigin' });
    };

    const settlePanelShape = (): void => {
      panel.style.removeProperty('transition');
      gsap.set(panel, { clearProps: 'transform,opacity,borderRadius,transformOrigin' });
    };

    const runLiquidMorph = (opening: boolean): void => {
      try { shapeMorphTween?.kill(); } catch (_) {}

      const toggleIsVisibleTrigger = toggle.offsetParent !== null
        && window.getComputedStyle(toggle).display !== 'none';

      if (this.prefersReducedMotion() || !toggleIsVisibleTrigger) {
        settleTogglePill();
        settlePanelShape();
        return;
      }

      const toggleRect = toggle.getBoundingClientRect();
      const widgetRect = widget.getBoundingClientRect();
      const naturalWidth = panel.offsetWidth;
      const naturalHeight = panel.offsetHeight;

      if (naturalWidth <= 0 || naturalHeight <= 0 || toggleRect.width <= 0 || toggleRect.height <= 0) {
        settleTogglePill();
        settlePanelShape();
        return;
      }

      // Panel is right:0 / bottom:0 within widget, so its natural (unscaled)
      // box always shares the widget's right/bottom edge.
      const naturalLeft = widgetRect.right - naturalWidth;
      const naturalTop = widgetRect.bottom - naturalHeight;
      const originX = toggleRect.left - naturalLeft;
      const originY = toggleRect.top - naturalTop;
      const originScaleX = toggleRect.width / naturalWidth;
      const originScaleY = toggleRect.height / naturalHeight;
      const pillRadius = Math.min(toggleRect.width, toggleRect.height) / 2;
      const panelRadius = parseFloat(
        window.getComputedStyle(panel).getPropertyValue('--chat-panel-radius')
      ) || 16;
      const morphDuration = 0.62;

      panel.style.setProperty('transition', 'none');
      toggle.style.setProperty('transition', 'none');
      gsap.set([panel, toggle], { transformOrigin: '0% 0%' });

      shapeMorphTween = this.track(gsap.timeline({
        onComplete: () => {
          settleTogglePill();
          settlePanelShape();
        },
      }));

      if (opening) {
        shapeMorphTween
          .set(panel, {
            x: originX,
            y: originY,
            scaleX: originScaleX,
            scaleY: originScaleY,
            borderRadius: pillRadius,
            opacity: 1,
          }, 0)
          .set(toggle, { opacity: 1 }, 0)
          .to(toggle, {
            opacity : 0,
            scale   : 0.92,
            duration: 0.15,
            ease    : 'power2.in',
          }, 0)
          .to(panel, {
            x        : 0,
            y        : 0,
            scaleX   : 1.015,
            scaleY   : 1.015,
            borderRadius: panelRadius,
            duration : morphDuration * 0.72,
            ease     : 'power3.out',
          }, 0.02)
          .to(panel, {
            scaleX  : 1,
            scaleY  : 1,
            duration: morphDuration * 0.3,
            ease    : 'power2.out',
          }, 0.02 + morphDuration * 0.6);
      } else {
        shapeMorphTween
          .set(toggle, { opacity: 0, scale: 0.92 }, 0)
          .to(panel, {
            x        : originX,
            y        : originY,
            scaleX   : originScaleX,
            scaleY   : originScaleY,
            borderRadius: pillRadius,
            opacity  : 0,
            duration : morphDuration,
            ease     : 'power3.inOut',
          }, 0)
          .to(toggle, {
            opacity : 1,
            scale   : 1,
            duration: 0.22,
            ease    : 'power2.out',
          }, morphDuration * 0.62);
      }
    };

    const setOpen = (nextOpen: boolean, floatingPanel = false): void => {
      isOpen = nextOpen;
      window.clearTimeout(morphTimer);

      widget.classList.remove('notes-widget--morphing', 'notes-widget--opening', 'notes-widget--closing');
      if (isOpen) {
        widget.classList.toggle('notes-widget--floating', floatingPanel);
        widget.classList.add('notes-widget--morphing', 'notes-widget--opening', 'notes-widget--open');
        panel.classList.add('notes-widget-panel--visible');
        panel.setAttribute('aria-hidden', 'false');
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', 'Close chat box');
        sideToggle?.setAttribute('aria-expanded', 'true');
        sideToggle?.setAttribute('aria-label', 'Close chat box');
      } else {
        widget.classList.add('notes-widget--morphing', 'notes-widget--closing');
        widget.classList.remove('notes-widget--open', 'notes-widget--floating');
        panel.classList.remove('notes-widget-panel--visible');
        panel.setAttribute('aria-hidden', 'true');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open chat box');
        sideToggle?.setAttribute('aria-expanded', 'false');
        sideToggle?.setAttribute('aria-label', 'Open chat box');
      }

      runLiquidMorph(isOpen);

      morphTimer = window.setTimeout(() => {
        widget.classList.remove('notes-widget--morphing', 'notes-widget--opening', 'notes-widget--closing');
        morphTimer = 0;
      }, this.prefersReducedMotion() ? 1 : 900);

      if (isOpen) {
        startIntroTypewriter();
      } else if (!hasTypedIntroMessage && introTypewriterTimeout) {
        window.clearTimeout(introTypewriterTimeout);
        introTypewriterTimeout = 0;
      }
    };

    const scrollChatToEnd = (): void => {
      if (!chatBody) return;
      chatBody.scrollTop = chatBody.scrollHeight;
    };

    const appendChatMessage = (role: 'user' | 'bot', text: string): HTMLElement | null => {
      if (!chatBody) return null;

      const messageEl = document.createElement('p');
      messageEl.className = `chatbox-message chatbox-message--${role}`;
      messageEl.textContent = text;
      this.applyScopeAttribute(messageEl);
      chatBody.appendChild(messageEl);
      scrollChatToEnd();
      return messageEl;
    };

    const getTypewriterDelay = (character: string): number => {
      if (character === '.' || character === '!' || character === '?') return 82;
      if (character === ',' || character === ';' || character === ':') return 44;
      if (character === ' ') return 12;
      return 18;
    };

    const typewriteMessageText = async (messageEl: HTMLElement, text: string): Promise<void> => {
      if (this.prefersReducedMotion()) {
        messageEl.textContent = text;
        scrollChatToEnd();
        return;
      }

      const characters = Array.from(text);
      messageEl.textContent = '';

      for (let index = 0; index < characters.length; index += 1) {
        if (this.isDestroyed) return;

        const character = characters[index];
        messageEl.textContent += character;

        if (index % 2 === 0 || index === characters.length - 1) {
          scrollChatToEnd();
        }

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, getTypewriterDelay(character));
        });
      }

      scrollChatToEnd();
    };

    const appendTypewriterChatMessage = async (role: 'user' | 'bot', text: string): Promise<HTMLElement | null> => {
      const shouldType = role === 'bot' && !this.prefersReducedMotion();
      const messageEl = appendChatMessage(role, shouldType ? '' : text);
      if (!messageEl || !shouldType) return messageEl;

      await typewriteMessageText(messageEl, text);

      return messageEl;
    };

    const startIntroTypewriter = (): void => {
      if (!introMessage || hasTypedIntroMessage || !introText) return;

      if (this.prefersReducedMotion()) {
        introMessage.textContent = introText;
        hasTypedIntroMessage = true;
        return;
      }

      window.clearTimeout(introTypewriterTimeout);
      introTypewriterTimeout = window.setTimeout(() => {
        if (this.isDestroyed || !isOpen || hasTypedIntroMessage) return;

        hasTypedIntroMessage = true;
        void typewriteMessageText(introMessage, introText);
      }, 2950);
    };

    const appendLiveTyping = (): HTMLElement | null => {
      if (!chatBody) return null;

      const typingEl = document.createElement('div');
      typingEl.className = 'chatbox-typing chatbox-typing--live';
      typingEl.setAttribute('aria-hidden', 'true');
      typingEl.innerHTML = '<span></span><span></span><span></span>';
      this.applyScopeAttribute(typingEl);
      chatBody.appendChild(typingEl);
      scrollChatToEnd();
      return typingEl;
    };

    const setChatBusy = (busy: boolean): void => {
      isWaitingForReply = busy;
      if (chatInput) chatInput.disabled = busy;
      if (chatSubmit) chatSubmit.disabled = busy;
    };

    const waitForTypingCycles = (): Promise<void> => {
      const dotCycleMs = 900;
      const cycles = 2 + Math.floor(Math.random() * 2);

      return new Promise((resolve) => {
        window.setTimeout(resolve, dotCycleMs * cycles);
      });
    };

    const requestChatReply = async (
      message: string,
      history: Array<{ role: 'user' | 'assistant'; content: string }>
    ): Promise<string> => {
      type ChatApiPayload = { reply?: string; error?: string };
      const body = JSON.stringify({
        message,
        history,
      });
      const sendChatRequest = (url: string): Promise<Response> => fetch(url, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
      let response = await sendChatRequest('/api/chat');

      if (response.status === 404 && isLocalHost) {
        response = await sendChatRequest('http://localhost:3001/api/chat');
      }

      const payload = await response.json().catch(() => ({} as ChatApiPayload)) as ChatApiPayload;

      if (!response.ok) {
        const deploymentHint = response.status === 405
          ? 'The deployed /api/chat function is not active on Vercel. Push the api folder, confirm vercel.json is deployed, then redeploy.'
          : response.status === 404
            ? 'The deployed /api/chat function was not found. Make sure api/chat.js is included in the Vercel deployment.'
            : '';
        throw new Error(payload.error?.trim() || deploymentHint || `Chat request failed with ${response.status}`);
      }

      return payload.reply?.trim() || "I'm here, but I couldn't shape a reply just now.";
    };

    const submitChatMessage = async (): Promise<void> => {
      if (!chatBody || !chatInput || isWaitingForReply) return;

      const message = chatInput.value.trim();
      if (!message) return;

      const requestHistory = chatHistory.slice(-8);
      appendChatMessage('user', message);
      chatHistory.push({ role: 'user', content: message });
      chatInput.value = '';

      const typingEl = appendLiveTyping();
      const typingDelay = waitForTypingCycles();
      setChatBusy(true);

      try {
        const reply = await requestChatReply(message, requestHistory);
        await typingDelay;
        if (this.isDestroyed) return;
        try { typingEl?.remove(); } catch (_) {}
        await appendTypewriterChatMessage('bot', reply);
        chatHistory.push({ role: 'assistant', content: reply });
      } catch (error) {
        await typingDelay;
        if (this.isDestroyed) return;
        try { typingEl?.remove(); } catch (_) {}
        const detail = error instanceof Error && error.message
          ? error.message
          : 'Please try again in a moment.';
        await appendTypewriterChatMessage('bot', `Connection issue: ${detail}`);
      } finally {
        if (this.isDestroyed) return;
        setChatBusy(false);
        chatInput.focus();
      }
    };

    const onToggleClick = (): void => setOpen(!isOpen);
    const onSideToggleClick = (): void => setOpen(!isOpen, !isOpen);
    const onCloseClick = (): void => setOpen(false);
    const onChatSubmit = (event: SubmitEvent): void => {
      event.preventDefault();
      void submitChatMessage();
    };

    toggle.setAttribute('aria-expanded', 'false');
    sideToggle?.setAttribute('aria-expanded', 'false');
    this.triggerMobileNotesAnimation = null;
    toggle.addEventListener('click', onToggleClick);
    sideToggle?.addEventListener('click', onSideToggleClick);
    if (closeButton) closeButton.addEventListener('click', onCloseClick);
    if (chatForm) chatForm.addEventListener('submit', onChatSubmit);

    this.cleanupFns.push(() => {
      window.clearTimeout(introTypewriterTimeout);
      window.clearTimeout(morphTimer);
      try { shapeMorphTween?.kill(); } catch (_) {}
      panel.style.removeProperty('transition');
      toggle.style.removeProperty('transition');
      widget.classList.remove('notes-widget--morphing', 'notes-widget--opening', 'notes-widget--closing', 'notes-widget--floating');
      toggle.removeEventListener('click', onToggleClick);
      sideToggle?.removeEventListener('click', onSideToggleClick);
      if (closeButton) closeButton.removeEventListener('click', onCloseClick);
      if (chatForm) chatForm.removeEventListener('submit', onChatSubmit);

      if (widget.parentNode === document.body) {
        if (originalParent?.isConnected) {
          originalParent.insertBefore(
            widget,
            originalNextSibling?.parentNode === originalParent ? originalNextSibling : null
          );
        } else {
          widget.remove();
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Performance + helpers
  // ---------------------------------------------------------------------------

  private isPerformanceModeEnabled(): boolean {
    if (typeof window === 'undefined') return true;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const smallViewport = window.innerWidth <= 900;
    const cores         = navigator.hardwareConcurrency ?? 8;
    const deviceMemory  = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    return reducedMotion || smallViewport || cores <= 4 || deviceMemory <= 4;
  }

  private applyPerformanceClasses(): void {
    const pageCanvas = document.querySelector<HTMLElement>('.page-canvas');
    if (pageCanvas) pageCanvas.classList.toggle('perf-lite', this.perfLite);
  }

  private track<T extends gsap.core.Animation>(animation: T): T {
    this.animations.push(animation);
    return animation;
  }

  private startHeroAnimations(): void {
    if (this.heroAnimationsStarted) return;
    this.heroAnimationsStarted = true;
    this.animateHero();
  }

  private playLandingLoader(): Promise<void> {
    const loader       = document.querySelector<HTMLElement>('.landing-loader');
    const loaderText   = document.querySelector<HTMLElement>('.landing-loader-text');
    const loaderRound  = document.querySelector<HTMLElement>('.landing-loader-round');
    const welcomeTexts = gsap.utils.toArray<HTMLElement>('.landing-welcome-text');

    if (loader && this.prefersReducedMotion()) {
      try { loader.remove(); } catch (_) {}
      return Promise.resolve();
    }

    if (!loader || !loaderText || !loaderRound || welcomeTexts.length === 0) {
      return Promise.resolve();
    }

    const speed                = this.perfLite ? 0.82 : 1;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    type GraphemeSegmenter = { segment(value: string): Iterable<{ segment: string }> };
    const Segmenter = (Intl as typeof Intl & {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: 'grapheme' }
      ) => GraphemeSegmenter;
    }).Segmenter;
    const segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null;
    const splitGraphemes = (value: string): string[] =>
      segmenter
        ? Array.from(segmenter.segment(value), part => part.segment)
        : Array.from(value);

    const renderLetters = (heading: HTMLElement, label: string): HTMLElement[] => {
      heading.textContent = '';
      heading.setAttribute('aria-label', label);

      return splitGraphemes(label).map((character) => {
        const letter = document.createElement('span');
        letter.className = character === ' ' ? 'landing-letter landing-letter--space' : 'landing-letter';
        letter.textContent = character === ' ' ? ' ' : character;
        heading.appendChild(letter);
        return letter;
      });
    };

    const textStates = welcomeTexts
      .map((text) => {
        const heading = text.querySelector<HTMLElement>('h2');
        const label = heading?.textContent?.trim() ?? '';

        return heading && label
          ? { text, heading, letters: renderLetters(heading, label) }
          : null;
      })
      .filter((state): state is {
        text: HTMLElement;
        heading: HTMLElement;
        letters: HTMLElement[];
      } => Boolean(state));
    const allLetters = textStates.flatMap(state => state.letters);

    const minGreetingPace = 0.42;
    const morphOverlap = 0;
    const getPaceForSpeed = (index: number, baseSpeed: number): number => {
      const lastIndex = Math.max(0, textStates.length - 1);
      if (index === 0 || index === lastIndex) return baseSpeed;

      const accelerationProgress = index / Math.max(1, lastIndex - 1);
      const acceleratedPace = 0.88 - 0.46 * Math.pow(accelerationProgress, 1.35);
      return baseSpeed * Math.max(minGreetingPace, acceleratedPace);
    };
    // Duration of just the language morph loop (first letter-in to last
    // letter's hold) — excludes the loader's own open delay and its
    // slide-away close, which are the tab's chrome, not the morph itself.
    const projectMorphDuration = (baseSpeed: number): number => {
      const lastIndex = Math.max(0, textStates.length - 1);
      let cursor = 0;

      textStates.forEach((state, index) => {
        const isFirst = index === 0;
        const isLast = index === lastIndex;
        const pace = getPaceForSpeed(index, baseSpeed);
        const inDuration = (isFirst ? 0.34 : 0.22) * pace;
        const outDuration = 0.18 * pace;
        const inStagger = 0.014 * pace;
        const outStagger = 0.014 * pace;
        const holdTime = (isFirst || isLast ? 0.42 : 0.08) * pace;
        const revealTime = inDuration + (state.letters.length - 1) * inStagger;
        const exitTime = outDuration + (state.letters.length - 1) * outStagger;

        if (isLast) {
          cursor += revealTime + holdTime;
        } else {
          const outStart = cursor + revealTime + holdTime;
          cursor = outStart + exitTime * morphOverlap;
        }
      });

      return cursor;
    };

    const targetMorphSeconds = 1.9;
    const projectedMorphDuration = projectMorphDuration(speed);
    const effectiveSpeed = projectedMorphDuration > 0
      ? speed * (targetMorphSeconds / projectedMorphDuration)
      : speed;

    gsap.set(welcomeTexts, { autoAlpha: 0 });
    gsap.set(allLetters, {
      autoAlpha: 0,
      x: 0,
      y: 0,
      rotationY: 0,
      scaleX: 0.18,
      scaleY: 1.16,
      filter: 'blur(5px)',
    });
    gsap.set(loaderText,   { y: 0, autoAlpha: 1, force3D: false });
    gsap.set(loaderRound,  { scaleY: 1 });

    return new Promise((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        document.body.style.overflow = previousBodyOverflow;
        document.documentElement.style.overflow = previousHtmlOverflow;
        try { loader.remove(); } catch (_) {}
        resolve();
      };

      this.cleanupFns.push(settle);

      const timeline = this.track(
        gsap.timeline({
          defaults: { ease: 'power2.inOut' },
          onComplete : settle,
          onInterrupt: settle,
        })
      );

      let morphStart = 0.42 * speed;
      const getGreetingPace = (index: number): number => getPaceForSpeed(index, effectiveSpeed);

      textStates.forEach((state, index) => {
        const isFirst = index === 0;
        const isLast = index === textStates.length - 1;
        const pace = getGreetingPace(index);
        const inDuration = (isFirst ? 0.34 : 0.22) * pace;
        const outDuration = 0.18 * pace;
        const inStagger = 0.014 * pace;
        const outStagger = 0.014 * pace;
        const holdTime = (isFirst || isLast ? 0.42 : 0.08) * pace;
        const revealTime = inDuration + (state.letters.length - 1) * inStagger;
        const exitTime = outDuration + (state.letters.length - 1) * outStagger;
        const middleIndex = (state.letters.length - 1) / 2;
        const collapseX = (letterIndex: number): number => (middleIndex - letterIndex) * 13;
        const collapseY = (letterIndex: number): number =>
          Math.sin((index + 1) * 1.4 + letterIndex * 0.9) * 5;

        timeline
          .set(state.text, { autoAlpha: 1 }, morphStart)
          .fromTo(
            state.letters,
            {
              autoAlpha: 0,
              x        : collapseX,
              y        : collapseY,
              rotationY: -78,
              scaleX   : 0.18,
              scaleY   : 1.16,
              filter   : 'blur(5px)',
            },
            {
              autoAlpha: 1,
              x        : 0,
              y        : 0,
              rotationY: 0,
              scaleX   : 1,
              scaleY   : 1,
              filter   : 'blur(0px)',
              duration : inDuration,
              ease     : 'expo.out',
              stagger  : { each: inStagger, from: 'center' },
            },
            morphStart
          );

        if (isLast) {
          timeline.to(state.text, { scale: 1, duration: holdTime, ease: 'none' }, morphStart + revealTime);
        } else {
          const outStart = morphStart + revealTime + holdTime;
          timeline
            .to(state.letters, {
              autoAlpha: 0,
              x        : collapseX,
              y        : (letterIndex: number) => collapseY(letterIndex) * -0.8,
              rotationY: 78,
              scaleX   : 0.14,
              scaleY   : 1.22,
              filter   : 'blur(5px)',
              duration : outDuration,
              ease     : 'power3.in',
              stagger  : { each: outStagger, from: 'center' },
            }, outStart)
            .set(state.text, { autoAlpha: 0 }, outStart + exitTime + 0.02 * pace);

          morphStart = outStart + exitTime * morphOverlap;
        }
      });

      timeline
        .call(() => loader.classList.add('is-exiting'), undefined, `+=${0.18 * speed}`)
        .to(loaderText, { y: -32, autoAlpha: 0, duration: 0.28 * speed, ease: this.motion.ease.move, force3D: false })
        .call(() => { if (this.isDestroyed) return; this.startHeroAnimations(); })
        .to(loader, { yPercent: -110, duration: 0.64 * speed, ease: this.motion.ease.move, force3D: true }, '-=0.06');
    });
  }

  private animateHero(): void {
    const baseDuration = this.perfLite ? 0.78 : 1;
    const tl = this.track(gsap.timeline({ defaults: { ease: this.motion.ease.enter } }));

    tl.from('.hero-nav',       { y: -16, autoAlpha: 0, duration: this.motion.duration.reveal * baseDuration })
      .from('.hero-name',      { y: this.motion.distance.hero, autoAlpha: 0, duration: this.motion.duration.slow * baseDuration }, '-=0.26')
      .from('.hero-professions',{ y: 18, autoAlpha: 0, duration: this.motion.duration.reveal * baseDuration }, '-=0.58')
      .fromTo(
        '.solari-tile',
        { autoAlpha: 0, rotateX: 90 },
        {
          autoAlpha      : 1,
          rotateX        : 0,
          duration       : this.perfLite ? 0.42 : 0.5,
          stagger        : this.perfLite ? 0.04 : 0.05,
          ease           : 'power4.out',
          transformOrigin: 'center center',
        },
        '+=0.02'
      )
      .call(() => this.showSolariTarget())
      .from('.hero-meta', { y: 8, autoAlpha: 0, duration: 0.56 * baseDuration }, '-=0.18')
      .fromTo(
        '.notes-widget',
        { x: this.motion.distance.reveal, autoAlpha: 0 },
        { x: 0, autoAlpha: 1, duration: this.motion.duration.reveal * baseDuration },
        '-=0.24'
      )
      .call(() => {
        if (this.triggerMobileNotesAnimation) {
          this.triggerMobileNotesAnimation();
          this.triggerMobileNotesAnimation = null;
        }
      })
      .from('.hero-local-time', { y: 18, autoAlpha: 0, duration: 0.74 * baseDuration }, '-=0.46')
      .from('.scroll-text',     { y: 12, autoAlpha: 0, duration: 0.74 * baseDuration }, '-=0.42')
      .from('.scroll-line',     { y: -10,autoAlpha: 0, duration: 0.7  * baseDuration }, '-=0.48');
  }

  // ---------------------------------------------------------------------------
  // Solari board
  // ---------------------------------------------------------------------------

  private injectSolariKeyframes(): void {
    if (document.querySelector('#hero-solari-keyframes')) return;

    const style = document.createElement('style');
    style.id = 'hero-solari-keyframes';
    style.textContent = `
      @keyframes solariFlapDown {
        from { transform: rotateX(0deg); }
        to { transform: rotateX(-90deg); }
      }

      @keyframes solariFlapUp {
        from { transform: rotateX(90deg); }
        to { transform: rotateX(0deg); }
      }
    `;
    document.head.appendChild(style);
  }

  private setupSolariBoard(): void {
    this.injectSolariKeyframes();
    const board = document.querySelector<HTMLElement>('.solari-board');

    if (!board) return;

    this.solariScopeAttr ??= this.getAngularScopeAttribute(board);

    if (!this.solariBoardInitialized) {
      this.buildSolariBoard(board);
      this.solariBoardInitialized = true;
    }

    if (this.prefersReducedMotion()) this.showSolariTarget();
  }

  private buildSolariBoard(board: HTMLElement): void {
    board.replaceChildren();
    this.solariTiles = [];
    const enableHoverGlitch = !this.perfLite && this.canUseHoverEffects();

    this.solariTarget.split('').forEach(() => {
      const tile = document.createElement('div');
      tile.className = 'solari-tile';
      tile.innerHTML = `
        <div class="solari-half solari-half--top"><span class="solari-char">.</span></div>
        <div class="solari-half solari-half--bottom"><span class="solari-char">.</span></div>
        <div class="solari-flap solari-flap--top"><span class="solari-char">.</span></div>
        <div class="solari-flap solari-flap--bottom"><span class="solari-char">.</span></div>
        <div class="solari-divider"></div>
      `;

      this.applyScopeAttribute(tile);
      board.appendChild(tile);
      tile.classList.add('is-dot');

      this.solariTiles.push({
        el    : tile,
        current: '.',
        htop  : tile.querySelector<HTMLElement>('.solari-half--top .solari-char')!,
        hbot  : tile.querySelector<HTMLElement>('.solari-half--bottom .solari-char')!,
        ftop  : tile.querySelector<HTMLElement>('.solari-flap--top')!,
        fbot  : tile.querySelector<HTMLElement>('.solari-flap--bottom')!,
        ftopc : tile.querySelector<HTMLElement>('.solari-flap--top .solari-char')!,
        fbotc : tile.querySelector<HTMLElement>('.solari-flap--bottom .solari-char')!,
        busy  : false,
        glitchTimer: null,
      });

      const created = this.solariTiles[this.solariTiles.length - 1];
      this.resetSolariTile(created, '.');

      if (enableHoverGlitch) {
        const onMouseEnter = () => this.startSolariGlitch(created);
        const onMouseLeave = () => this.stopSolariGlitch(created);
        created.el.addEventListener('mouseenter', onMouseEnter);
        created.el.addEventListener('mouseleave', onMouseLeave);
        this.cleanupFns.push(() => {
          try {
            created.el.removeEventListener('mouseenter', onMouseEnter);
            created.el.removeEventListener('mouseleave', onMouseLeave);
          } catch (_) {}
          this.stopSolariGlitch(created, false);
        });
      }
    });

    const onBoardClick = () => {
      if (this.solariIntroInProgress) return;
      if (this.prefersReducedMotion()) { this.showSolariTarget(); return; }
      this.replaySolariBoard();
    };

    board.addEventListener('click', onBoardClick);
    this.cleanupFns.push(() => board.removeEventListener('click', onBoardClick));
  }

  private getAngularScopeAttribute(element: HTMLElement): string | null {
    return element.getAttributeNames().find(name => name.startsWith('_ngcontent-')) ?? null;
  }

  private canUseHoverEffects(): boolean {
    return typeof window !== 'undefined'
      && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  private applyScopeAttribute(root: HTMLElement): void {
    if (!this.solariScopeAttr) return;
    root.setAttribute(this.solariScopeAttr, '');
    root.querySelectorAll<HTMLElement>('*').forEach(node =>
      node.setAttribute(this.solariScopeAttr!, '')
    );
  }

  private getSolariGlitchChar(): string {
    return this.solariGlitchChars.charAt(
      Math.floor(Math.random() * this.solariGlitchChars.length)
    );
  }

  private syncSolariGlyph(tile: SolariTile, character: string): void {
    tile.htop.textContent  = character;
    tile.hbot.textContent  = character;
    tile.ftopc.textContent = character;
    tile.fbotc.textContent = character;
  }

  private startSolariGlitch(tile: SolariTile): void {
    if (tile.busy || this.solariIntroInProgress || this.prefersReducedMotion()) return;
    if (tile.current === '.' || tile.glitchTimer !== null) return;

    tile.el.classList.add('is-glitching');

    const tick = () => {
      if (this.isDestroyed || tile.busy || this.solariIntroInProgress) {
        this.stopSolariGlitch(tile);
        return;
      }
      this.syncSolariGlyph(tile, this.getSolariGlitchChar());
      const baseDelay = this.perfLite ? 72 : 34;
      const spread    = this.perfLite ? 120 : 74;
      tile.glitchTimer = window.setTimeout(tick, baseDelay + Math.floor(Math.random() * spread));
    };

    tile.glitchTimer = window.setTimeout(tick, 0);
  }

  private stopSolariGlitch(tile: SolariTile, restore = true): void {
    if (tile.glitchTimer !== null) {
      window.clearTimeout(tile.glitchTimer);
      tile.glitchTimer = null;
    }
    tile.el.classList.remove('is-glitching');
    if (restore && !tile.busy) this.syncSolariGlyph(tile, tile.current);
  }

  private replaySolariBoard(): void {
    if (!this.solariTiles.length) return;
    this.solariRunId += 1;
    this.solariIntroInProgress = false;
    this.clearSolariTimers();
    this.resetSolariBoard();
    const runId = this.solariRunId;
    this.solariTarget.split('').forEach((letter, index) => {
      this.runSolariSequence(this.solariTiles[index], letter, 140 + index * 115, runId);
    });
  }

  private getSolariWordSlots(word: string, placeholder = '.'): string[] {
    const tileCount = this.solariTiles.length || this.solariTarget.length;
    const slots     = Array.from({ length: tileCount }, () => placeholder);
    const letters   = Array.from(word.toUpperCase()).slice(0, tileCount);
    const start     = Math.max(0, Math.floor((tileCount - letters.length) / 2));
    letters.forEach((letter, index) => { slots[start + index] = letter; });
    return slots;
  }

  private runSolariSequence(
    tile: SolariTile, target: string, startDelay: number, runId: number
  ): void {
    const totalFlips = 18 + Math.floor(Math.random() * 8);

    const gap = (step: number): number => {
      const p = step / totalFlips;
      return 80 + Math.pow(p, 2.4) * 300;
    };

    let step = 0;

    const next = (): void => {
      if (runId !== this.solariRunId || this.isDestroyed) return;
      const isLast = step === totalFlips - 1;
      const char   = isLast
        ? target
        : this.solariChars.charAt(Math.floor(Math.random() * this.solariChars.length));

      const tryFlip = (): void => {
        if (runId !== this.solariRunId || this.isDestroyed) return;
        if (tile.busy) { this.queueSolariTimer(tryFlip, 16); return; }
        this.flipSolariTile(tile, char, runId);
        step++;
        if (!isLast) this.queueSolariTimer(next, gap(step) + this.solariFlipMs);
      };

      tryFlip();
    };

    this.queueSolariTimer(next, startDelay);
  }

  private flipSolariTile(tile: SolariTile, newChar: string, runId: number): void {
    if ((runId !== 0 && runId !== this.solariRunId) || this.isDestroyed) return;

    if (tile.busy) {
      this.queueSolariTimer(() => this.flipSolariTile(tile, newChar, runId), 16);
      return;
    }

    if (tile.current === newChar) {
      this.updateSolariPlaceholderState(tile, newChar);
      return;
    }

    tile.busy = true;
    const oldChar = tile.current;
    tile.current  = newChar;
    this.updateSolariPlaceholderState(tile, newChar);

    tile.htop.textContent = newChar;
    tile.hbot.textContent = oldChar;

    tile.ftopc.textContent    = oldChar;
    tile.ftop.style.animation = 'none';
    tile.fbot.style.animation = 'none';
    void tile.ftop.offsetWidth;
    tile.ftop.style.animation = `solariFlapDown ${this.solariFlipMs}ms ease-in forwards`;

    tile.fbotc.textContent = newChar;
    this.queueSolariTimer(() => {
      if (this.isDestroyed) return;
      void tile.fbot.offsetWidth;
      tile.fbot.style.animation = `solariFlapUp ${this.solariFlipMs}ms ease-out forwards`;
    }, Math.round(this.solariFlipMs * 0.40));

    this.queueSolariTimer(() => {
      if (this.isDestroyed) return;
      tile.hbot.textContent     = newChar;
      tile.ftop.style.animation = 'none';
      tile.fbot.style.animation = 'none';
      void tile.ftop.offsetWidth;
      tile.ftop.style.transform  = '';
      tile.fbot.style.transform  = 'rotateX(90deg)';
    tile.ftopc.textContent     = newChar;
    tile.fbotc.textContent     = newChar;
    tile.el.classList.remove('is-flipping');
    this.updateSolariPlaceholderState(tile, newChar);
    tile.busy = false;
    }, this.solariFlipMs * 2 + 20);
  }

  private resetSolariBoard(character = '.'): void {
    this.solariTiles.forEach(tile => this.resetSolariTile(tile, character));
  }

  private showSolariTarget(): void {
    this.clearSolariTimers();
    this.solariRunId += 1;
    this.solariIntroInProgress = false;
    this.resetSolariToWord(this.solariTarget);
  }

  private resetSolariToWord(word: string, placeholder = '.'): void {
    this.getSolariWordSlots(word, placeholder).forEach((letter, index) => {
      const tile = this.solariTiles[index];
      if (!tile) return;
      this.resetSolariTile(tile, letter);
    });
  }

  private resetSolariTile(tile: SolariTile, character: string): void {
    this.stopSolariGlitch(tile, false);
    tile.current           = character;
    tile.htop.textContent  = character;
    tile.hbot.textContent  = character;
    tile.ftopc.textContent = character;
    tile.fbotc.textContent = character;
    tile.ftop.style.animation = 'none';
    tile.fbot.style.animation = 'none';
    tile.ftop.style.transform = '';
    tile.fbot.style.transform = 'rotateX(90deg)';
    tile.el.classList.remove('is-flipping');
    tile.el.classList.remove('is-misfiring');
    this.updateSolariPlaceholderState(tile, character);
    tile.busy = false;
  }

  private updateSolariPlaceholderState(tile: SolariTile, character: string): void {
    tile.el.classList.toggle('is-dot', character.trim() === '' || character === '.');
  }

  private queueSolariTimer(callback: () => void, delay: number): void {
    const timer = window.setTimeout(() => {
      this.solariTimers.delete(timer);
      callback();
    }, delay);
    this.solariTimers.add(timer);
  }

  private clearSolariTimers(): void {
    this.solariTimers.forEach(timer => window.clearTimeout(timer));
    this.solariTimers.clear();
    this.solariTiles.forEach(tile => {
      this.stopSolariGlitch(tile, false);
      try {
        tile.el.classList.remove('is-flipping');
        tile.el.classList.remove('is-misfiring');
      } catch (_) {}
    });
  }

  private prefersReducedMotion(): boolean {
    return typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private setupLocalTime(): void {
    const timeEls = Array.from(
      document.querySelectorAll<HTMLElement>('.local-time-value, [data-side-notch-time]')
    );
    if (timeEls.length === 0) return;

    const pad  = (n: number) => String(n).padStart(2, '0');
    const tick = () => {
      const t = new Date();
      const value = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
      timeEls.forEach((el) => {
        el.textContent = value;
      });
    };

    tick();

    const msToNextSecond = 1000 - (Date.now() % 1000);
    this.localTimeAligner = window.setTimeout(() => {
      tick();
      this.localTimeTimer  = window.setInterval(tick, 1000);
      this.localTimeAligner = null;
    }, msToNextSecond);

    this.cleanupFns.push(() => {
      if (this.localTimeAligner !== null) {
        window.clearTimeout(this.localTimeAligner);
        this.localTimeAligner = null;
      }
      if (this.localTimeTimer !== null) {
        window.clearInterval(this.localTimeTimer);
        this.localTimeTimer = null;
      }
    });
  }

  private setupBackgroundInstrumentation(): void {
    const dateEls = Array.from(
      document.querySelectorAll<HTMLElement>('[data-bg-current-date], [data-hero-current-date]')
    );

    if (dateEls.length === 0) return;

    const formatter = new Intl.DateTimeFormat('en-GB', {
      day  : '2-digit',
      month: 'short',
      year : 'numeric',
    });

    const updateDate = (): void => {
      const now = new Date();
      const value = formatter.format(now).replace(',', '').toUpperCase();
      const isoDate = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-');

      dateEls.forEach((el) => {
        el.textContent = value;
        if (el instanceof HTMLTimeElement) el.dateTime = isoDate;
      });
    };

    const scheduleNextDateTick = (): void => {
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 1, 0);
      const delay = Math.max(1000, nextMidnight.getTime() - now.getTime());

      this.backgroundDateTimer = window.setTimeout(() => {
        updateDate();
        scheduleNextDateTick();
      }, delay);
    };

    updateDate();
    scheduleNextDateTick();

    this.cleanupFns.push(() => {
      if (this.backgroundDateTimer !== null) {
        window.clearTimeout(this.backgroundDateTimer);
        this.backgroundDateTimer = null;
      }
    });
  }

}
