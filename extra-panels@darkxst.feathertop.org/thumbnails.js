//Mostly code copied from the shell, patched to make it monitor aware.

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Main = imports.ui.main;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const WorkspaceThumbnail = imports.ui.workspaceThumbnail;

const ThumbnailState = {
    NEW   :         0,
    ANIMATING_IN :  1,
    NORMAL:         2,
    REMOVING :      3,
    ANIMATING_OUT : 4,
    ANIMATED_OUT :  5,
    COLLAPSING :    6,
    DESTROYED :     7
};

const Thumbnails = new Lang.Class({
    Name: 'Thumbnails',

    _init: function(){
        this._controls = null;
        this.monitorIndex = 1;
        this._workspacesDisplay = Main.overview._workspacesDisplay;
        if (this._workspaceDisplay == undefined)
            this._workspacesDisplay = Main.overview._viewSelector._workspacesDisplay;

        this._workspacesDisplay._controls2 = this._controls;

        let monitor = Main.layoutManager.monitors[this.monitorIndex];

        this.actor = new Shell.GenericContainer();
        this.actor.connect('get-preferred-width', Lang.bind(this, this._getPreferredWidth));
        this.actor.connect('get-preferred-height', Lang.bind(this, this._getPreferredHeight));
        this.actor.connect('allocate', Lang.bind(this, this._allocate));
        //need to add the following
        //this.actor.connect('notify::mapped', Lang.bind(this, this._setupSwipeScrolling));
        this.actor.connect('parent-set', Lang.bind(this, this._parentSet));

        this.actor.set_position(monitor.x, monitor.y);

        let controls = new St.Bin({ style_class: 'workspace-controls',
                                    request_mode: Clutter.RequestMode.WIDTH_FOR_HEIGHT,
                                    y_align: St.Align.START,
                                    y_fill: true });

        this._controls = controls;
        this.actor.add_actor(controls);

        this._thumbnailsBox = new myThumbnailsBox(this.monitorIndex);
        //borrow rtl style to flip borders
        this._thumbnailsBox._background.set_style_pseudo_class('rtl');
        controls.add_actor(this._thumbnailsBox.actor);


        
    },
    _getPreferredWidth: function (actor, forHeight, alloc) {
        // pass through the call in case the child needs it, but report 0x0
        //this._controls[this.monitorIndex].get_preferred_width(forHeight);
        this._workspacesDisplay._controls.get_preferred_width(forHeight);
    },

    _getPreferredHeight: function (actor, forWidth, alloc) {
        // pass through the call in case the child needs it, but report 0x0
        //this._controls[this.monitorIndex].get_preferred_height(forWidth);
        this._workspacesDisplay._controls.get_preferred_height(forWidth);
    },

    _allocate: function (actor, box, flags) {
        let monitor = Main.layoutManager.monitors[this.monitorIndex];

        let x,y,width,height;
        [width,height] = this._workspacesDisplay._controls.get_size();
        [x,y] = this._workspacesDisplay._controls.get_transformed_position();
        
        let childBox = new Clutter.ActorBox();
        let totalWidth = box.x2 - box.x1;

        // width of the controls, here zoom always disabled with multiple monitors.

        let controlsReserved = width ;

        //let rtl = (Clutter.get_default_text_direction () == Clutter.TextDirection.RTL);
        let rtl = true;
        if (rtl) {
            childBox.x2 = controlsReserved;
            childBox.x1 = childBox.x2 - controlsReserved;
        } else {
            childBox.x1 = totalWidth - controlsReserved;
            childBox.x2 = childBox.x1 + controlsReserved;
        }

        childBox.y1 = y;
        childBox.y2 = childBox.y1 + height ;

        this._controls.allocate(childBox, flags);

        // this._updateWorkspacesGeometry();
    },
    _parentSet: function(actor, oldParent) {
        if (oldParent && this._notifyOpacityId)
            oldParent.disconnect(this._notifyOpacityId);
        this._notifyOpacityId = 0;

        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this,
            function() {
                let newParent = this.actor.get_parent();
                if (!newParent)
                    return;

                // This is kinda hackish - we want the primary view to
                // appear as parent of this.actor, though in reality it
                // is added directly to overlay_group
                /*this._notifyOpacityId = newParent.connect('notify::opacity',
                    Lang.bind(this, function() {
                        let opacity = this.actor.get_parent().opacity;
                        let primaryView = this._getPrimaryView();
                        if (!primaryView)
                            return;
                        primaryView.actor.opacity = opacity;
                        if (opacity == 0)
                            primaryView.actor.hide();
                        else
                            primaryView.actor.show();
                    }));*/
        }));
    },
});

const myWorkspaceThumbnail = new Lang.Class({
    Name: 'myWorkspaceThumbnail',
    Extends: WorkspaceThumbnail.WorkspaceThumbnail,

    _init: function(metaWorkspace, monitorIndex){
    	this.metaWorkspace = metaWorkspace;
        this.monitorIndex = monitorIndex;

        this._removed = false;

        this.actor = new St.Widget({ clip_to_allocation: true,
                                     style_class: 'workspace-thumbnail' });
        this.actor._delegate = this;

        this._contents = new Clutter.Group();
        this.actor.add_actor(this._contents);

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        this._background = Meta.BackgroundActor.new_for_screen(global.screen);
        this._contents.add_actor(this._background);

        let monitor = Main.layoutManager.monitors[monitorIndex];
        this.setPorthole(monitor.x, monitor.y, monitor.width, monitor.height);

        let windows = global.get_window_actors().filter(this._isWorkspaceWindow, this);

        // Create clones for windows that should be visible in the Overview
        this._windows = [];
        this._allWindows = [];
        this._minimizedChangedIds = [];
        for (let i = 0; i < windows.length; i++) {
            let minimizedChangedId =
                windows[i].meta_window.connect('notify::minimized',
                                               Lang.bind(this,
                                                         this._updateMinimized));
            this._allWindows.push(windows[i].meta_window);
            this._minimizedChangedIds.push(minimizedChangedId);

            if (this._isMyWindow(windows[i]) && this._isOverviewWindow(windows[i])) {
                this._addWindowClone(windows[i]);
            }

	    }
        // Track window changes
        this._windowAddedId = this.metaWorkspace.connect('window-added',
                                                          Lang.bind(this, this._windowAdded));
        this._windowRemovedId = this.metaWorkspace.connect('window-removed',
                                                           Lang.bind(this, this._windowRemoved));
        this._windowEnteredMonitorId = global.screen.connect('window-entered-monitor',
                                                           Lang.bind(this, this._windowEnteredMonitor));
        this._windowLeftMonitorId = global.screen.connect('window-left-monitor',
                                                           Lang.bind(this, this._windowLeftMonitor));

        this.state = ThumbnailState.NORMAL;
        this._slidePosition = 0; // Fully slid in
        this._collapseFraction = 0; // Not collapsed
	}
});

const myThumbnailsBox = new Lang.Class({
    Name: 'myThumbnailsBox',
    Extends: WorkspaceThumbnail.ThumbnailsBox,

    //need to add 
    //this.monitorIndex
    _init: function(monitorIndex){
    	this.parent();
    	this.monitorIndex = monitorIndex;
    },
    show: function() {
    	this._switchWorkspaceNotifyId =
        global.window_manager.connect('switch-workspace',
                                       Lang.bind(this, this._activeWorkspaceChanged));

        this._targetScale = 0;
        this._scale = 0;
        this._pendingScaleUpdate = false;
        this._stateUpdateQueued = false;

        this._stateCounts = {};
        for (let key in ThumbnailState)
            this._stateCounts[ThumbnailState[key]] = 0;

        // The "porthole" is the portion of the screen that we show in the workspaces
        let panelHeight = Main.panel.actor.height;
    	let monitor = Main.layoutManager.monitors[this.monitorIndex];
        //let monitor = Main.layoutManager.monitors[0];
    	this._porthole = {
            x: monitor.x,
            y: monitor.y + panelHeight,
            width: monitor.width,
            height: monitor.height - panelHeight
        };
        this.addThumbnails(0, global.screen.n_workspaces);
    },

    addThumbnails: function(start,count){

    	//update porthole + create thumbnails
    	for (let k = start; k < start + count; k++) {
            let metaWorkspace = global.screen.get_workspace_by_index(k);
            let thumbnail = new myWorkspaceThumbnail(metaWorkspace, this.monitorIndex);
            //let thumbnail = new WorkspaceThumbnail.WorkspaceThumbnail(metaWorkspace);
            thumbnail.setPorthole(this._porthole.x, this._porthole.y,
                                  this._porthole.width, this._porthole.height);
            this._thumbnails.push(thumbnail);
            this.actor.add_actor(thumbnail.actor);

            if (start > 0) { // not the initial fill
                thumbnail.state = ThumbnailState.NEW;
                thumbnail.slidePosition = 1; // start slid out
                this._haveNewThumbnails = true;
            } else {
                thumbnail.state = ThumbnailState.NORMAL;
            }

            this._stateCounts[thumbnail.state]++;
        }

        this._queueUpdateStates();

        // The thumbnails indicator actually needs to be on top of the thumbnails
        this._indicator.raise_top();
     }
});
