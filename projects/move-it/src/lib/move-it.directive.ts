import { Directive, ElementRef, Input, Output, EventEmitter, OnDestroy, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core';
import { Observable, fromEvent, Subscription, merge } from 'rxjs';
import { map, takeUntil, mergeMap, filter, tap } from 'rxjs/operators';
import { DraggablePosition, DraggableMovingPosition, MousePosition } from './move-it-types';
import { MoveItService } from './move-it.service';

@Directive({
  selector: '[ngMoveit]',
  providers: [MoveItService]
})
export class MoveItDirective implements AfterViewInit, OnDestroy, OnChanges {

  @Input() draggableFrom: string;
  @Input() bounds: HTMLElement = document.body;
  @Input() columnWidth = 1;
  @Input() dashboardDimensionsChanged: number;

  // Emitted events
  @Output() mDragStart: EventEmitter<DraggablePosition> = new EventEmitter<DraggablePosition>();
  @Output() mDragMove: EventEmitter<DraggableMovingPosition> = new EventEmitter<DraggableMovingPosition>();
  @Output() mDragStop: EventEmitter<DraggablePosition> = new EventEmitter<DraggablePosition>();

  // Event observables
  mousedown$: Observable<MouseEvent>;
  mousemove$: Observable<MouseEvent>;
  mouseup$: Observable<MouseEvent>;
  touchstart$: Observable<TouchEvent>;
  touchmove$: Observable<TouchEvent>;
  touchend$: Observable<TouchEvent>;
  touchcancel$: Observable<TouchEvent>;
  start$: Observable<MouseEvent | TouchEvent>;
  move$: Observable<MouseEvent | TouchEvent>;
  stop$: Observable<MouseEvent | TouchEvent>;
  drag$: Observable<MousePosition>;
  dragSub: Subscription;

  // Window size
  windowResize$: Observable<Event> = fromEvent(window, 'resize');
  windowResizeSub: Subscription;

  constructor(
    private el: ElementRef,
    private moveitService: MoveItService
  ) { }

  ngAfterViewInit() {
    // Find draggable element and disable html drag
    this.moveitService.draggable = this.el.nativeElement;
    this.moveitService.draggable.draggable = false;

    // Get dimensions
    setTimeout(() => {
      this.moveitService.getContainerDimensions(this.bounds);
      this.moveitService.initDraggableDimensions();
      this.moveitService.draggableLeftRatio = 0;
      this.moveitService.draggableTopRatio = 0;
      this.moveitService.getBounds();
    }, 200);

    // Handle from a specific part of draggable element
    this.moveitService.handle = this.moveitService.draggable;
    if (this.draggableFrom) {
      this.moveitService.handle = this.moveitService.draggable.querySelector('.' + this.draggableFrom);
    }

    // Create event listeners
    this.mousedown$ = fromEvent(this.moveitService.handle, 'mousedown') as Observable<MouseEvent>;
    this.mousemove$ = fromEvent(document, 'mousemove') as Observable<MouseEvent>;
    this.mouseup$ = fromEvent(document, 'mouseup') as Observable<MouseEvent>;
    this.touchstart$ = fromEvent(this.moveitService.handle, 'touchstart') as Observable<TouchEvent>;
    this.touchmove$ = fromEvent(document, 'touchmove') as Observable<TouchEvent>;
    this.touchend$ = fromEvent(document, 'touchend') as Observable<TouchEvent>;
    this.touchcancel$ = fromEvent(document, 'touchcancel') as Observable<TouchEvent>;
    this.start$ = merge(this.mousedown$, this.touchstart$);
    this.move$ = merge(this.mousemove$, this.touchmove$);
    this.stop$ = merge(this.mouseup$, this.touchend$, this.touchcancel$);

    // Create mousedrag observable
    this.drag$ = this.initDragObservable();

    // Listen to mousedrag observable
    this.dragSub = this.drag$.subscribe(mousePos => {
      this.move(mousePos.left, mousePos.top);
    });

    // Listen to window resize observable
    this.windowResizeSub = this.windowResize$.subscribe(() => {
      // Get container dimensions
      this.moveitService.getContainerDimensions(this.bounds);
      this.moveitService.initDraggableDimensions();
      // Get container bounds
      this.moveitService.getBounds();
      // Move element proportionnally to its container
      if (this.bounds === document.body) {
        this.move(this.moveitService.containerDimensions.width * this.moveitService.draggableLeftRatio,
          this.moveitService.containerDimensions.height * this.moveitService.draggableTopRatio);
      }
    });
  }

  ngOnDestroy() {
    this.dragSub.unsubscribe();
    this.windowResizeSub.unsubscribe();
  }

  initDragObservable(): Observable<MousePosition> {
    // START LISTENER
    return this.start$.pipe(
      // Only from left button or any touch event
      filter(mdEvent => (mdEvent instanceof MouseEvent
        && mdEvent.button === 0 // left click
        && (this.draggableFrom // draggableFrom provided
        && (mdEvent.target as Element).classList.contains(this.draggableFrom) // only handle (and not handle children)
        || (this.draggableFrom === undefined && (mdEvent.target as Element).className !== 'resize-handle')) // exclude resize-handle
        // || mdEvent instanceof TouchEvent
        )
      ),
      mergeMap(mdEvent => {
        const mdPos: MousePosition = this.onMouseDown(mdEvent);
        // MOVE LISTENER
        return this.move$.pipe(
          map(mmEvent => {
            const mmPos: MousePosition = this.onMouseMove(mmEvent);
            return {
              left: mmPos.left - mdPos.left,
              top: mmPos.top - mdPos.top,
            };
          }),
          // STOP LISTENER
          takeUntil(this.stop$.pipe(
            tap(() => this.onMouseUp())
          ))
        );
      }),
    );
  }

  onMouseDown(mdEvent: MouseEvent | TouchEvent): MousePosition {
    // Disable native behavior of some elements inside the draggable element (ex: images)
    this.moveitService.draggable.style.pointerEvents = 'none';
    // Add style to moving element
    this.moveitService.draggable.classList.add('moving');
    // Special class to disable text hightlighting
    document.body.classList.add('no-select', 'dragging');
    // Disable autoscroll of touch event
    // if (mdEvent instanceof TouchEvent) { // to fix: FF does not handle TouchEvent
    //   mdEvent.preventDefault();
    // }
    // Emit draggable start position
    const startPos: DraggablePosition = {
      item: this.moveitService.draggable,
      initLeft: this.moveitService.draggableDimensions.left,
      initTop: this.moveitService.draggableDimensions.top,
      offsetLeft: this.moveitService.getOffsetX(),
      offsetTop: this.moveitService.getOffsetY()
    };
    this.mDragStart.emit(startPos);
    // Get pointer start position and return it
    const mdClientX = mdEvent instanceof MouseEvent ? mdEvent.clientX : mdEvent.touches[0].clientX;
    const mdClientY = mdEvent instanceof MouseEvent ? mdEvent.clientY : mdEvent.touches[0].clientY;
    const startX = mdClientX - startPos.offsetLeft;
    const startY = mdClientY - startPos.offsetTop + this.bounds.scrollTop;
    return {
      left: startX,
      top: startY
    };
  }

  onMouseMove(mmEvent: MouseEvent | TouchEvent) {
    // Get mouse / touch position
    const mmClientX = mmEvent instanceof MouseEvent ? mmEvent.clientX : mmEvent.touches[0].clientX;
    const mmClientY = mmEvent instanceof MouseEvent ? mmEvent.clientY : mmEvent.touches[0].clientY;
    // Return position
    return {
      left: mmClientX,
      top: mmClientY + this.bounds.scrollTop,
    };
  }

  onMouseUp(): void {
    // Remove styles
    this.moveitService.draggable.style.pointerEvents = 'unset';
    this.moveitService.draggable.classList.remove('moving');
    document.body.classList.remove('no-select', 'dragging');
    this.moveitService.clearSelection();

    const shadowOffset = this.moveitService.draggable.style.filter.match(/[-]{0,1}[\d]*[\.]{0,1}[\d]+/g);
    const shadowOffsetX = shadowOffset ? parseFloat(shadowOffset[4]) : 0;
    const shadowOffsetY = shadowOffset ? parseFloat(shadowOffset[5]) : 0;
    this.moveitService.draggable.style.filter = 'unset';
    // Emit position
    const finalPos: DraggablePosition = {
      item: this.moveitService.draggable,
      initLeft: this.moveitService.draggableDimensions.left,
      initTop: this.moveitService.draggableDimensions.top,
      offsetLeft: this.moveitService.getOffsetX() + shadowOffsetX,
      offsetTop: this.moveitService.getOffsetY() + shadowOffsetY
    };

    const translateX = 'translateX(' + finalPos.offsetLeft + 'px) ';
    const translateY = 'translateY(' + finalPos.offsetTop + 'px)';
    this.moveitService.draggable.style.transform = translateX + translateY;
    this.mDragStop.emit(finalPos);

    // This is for window resize
    this.moveitService.draggableLeftRatio = finalPos.offsetLeft / this.moveitService.containerDimensions.width;
    this.moveitService.draggableTopRatio = finalPos.offsetTop / this.moveitService.containerDimensions.height;
  }

  move(leftPos: number, topPos: number): void {
    // Check bounds
    const checkedPos = this.moveitService.checkBounds(leftPos, topPos, this.columnWidth);

    const movingPos: DraggableMovingPosition = {
      item: this.moveitService.draggable,
      initLeft: this.moveitService.draggableDimensions.left,
      initTop: this.moveitService.draggableDimensions.top,
      offsetLeft: checkedPos.offsetLeft,
      offsetTop: checkedPos.offsetTop,
      leftEdge: checkedPos.leftEdge,
      rightEdge: checkedPos.rightEdge,
      topEdge: checkedPos.topEdge,
      bottomEdge: checkedPos.bottomEdge
    };

    // Move draggable element
    const translateX = 'translateX(' + leftPos + 'px) ';
    const translateY = 'translateY(' + topPos + 'px)';
    this.moveitService.draggable.style.transform = translateX + translateY;

    // tslint:disable-next-line:max-line-length
    const shadowFilter = 'drop-shadow(rgba(0, 0, 0, 0.2) ' + (checkedPos.offsetLeft - leftPos) + 'px ' + (checkedPos.offsetTop - topPos) + 'px 0px)';
    this.moveitService.draggable.style.filter = shadowFilter;

    // Emit position
    this.mDragMove.emit(movingPos);
  }

  ngOnChanges(changes: SimpleChanges) {
    // new pages added to dashboard or dezoomed dashboard
    if (changes['dashboardDimensionsChanged'] && !changes['dashboardDimensionsChanged'].firstChange) {
      this.moveitService.getContainerDimensions(this.bounds);
      this.moveitService.initDraggableDimensions();
      this.moveitService.getBounds();
      this.moveitService.draggableLeftRatio =
        this.moveitService.getOffsetX() / this.moveitService.containerDimensions.width;
      this.moveitService.draggableTopRatio =
        this.moveitService.getOffsetY() / this.moveitService.containerDimensions.height;
    }

    if (changes['draggableFrom'] && !changes['draggableFrom'].firstChange) {
      // Change of draggableFrom input
      this.moveitService.handle = this.moveitService.draggable;
      if (this.draggableFrom) {
        setTimeout(() => this.moveitService.handle = this.moveitService.draggable.querySelector('.' + this.draggableFrom));
      }
      this.mousedown$ = fromEvent(this.moveitService.handle, 'mousedown') as Observable<MouseEvent>;
      this.touchstart$ = fromEvent(this.moveitService.handle, 'touchstart') as Observable<TouchEvent>;
      this.start$ = merge(this.mousedown$, this.touchstart$);
      this.drag$ = this.initDragObservable();
      this.dragSub = this.drag$.subscribe(mousePos => {
        this.move(mousePos.left, mousePos.top);
      });
    }
  }

}
