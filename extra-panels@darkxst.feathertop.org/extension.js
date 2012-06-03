// Multiple Monitor Panels
// Copyright (C) 2012 darkxst

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Author: darkxst

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Layout = imports.ui.layout;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Overview = imports.ui.overview;
const Panel = imports.ui.panel;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Tweener = imports.ui.tweener;
const WorkspacesView = imports.ui.workspacesView;

const ExtensionSystem = imports.ui.extensionSystem;
const ExtensionUtils = imports.misc.extensionUtils;

const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const WorkspaceThumbnails = Me.imports.thumbnails;
//const WT = imports.ui.workspaceThumbnail;

//const extension = imports.misc.extensionUtils.getCurrentExtension();
//const metadata = extension.metadata;

let eP, Schema, panels;

const ExtraPanels = new Lang.Class({
    Name: 'ExtraPanels',

    _init : function() {
        Schema = Convenience.getSettings();
        this.Schema = Schema;
        this.monitors = Main.layoutManager.monitors;
        this.primaryIndex = Main.layoutManager.primaryIndex;
        this.panelBoxes = [];
        this.panels = [];
        this.thumbnails = [];
        Main.layoutManager.panelBoxes = this.panelBoxes;
        
        for (let i = 0; i < this.monitors.length; i++) {
            if (i == this.primaryIndex)
                continue;

            this.panelBoxes[i] = new St.BoxLayout({ name: 'panelBox'+(i+1), vertical: true });
            Main.layoutManager.addChrome(this.panelBoxes[i], { affectsStruts: true });
            this.panels[i] = new Panel.Panel();
            Main.layoutManager.panelBox.remove_actor(this.panels[i].actor);
            this.panelBoxes[i].add(this.panels[i].actor)
            this.panelBoxes[i].set_position(this.monitors[i].x, this.monitors[i].y);
            this.panelBoxes[i].set_width(this.monitors[i].width);

            this._updateCorners(i);
            let barrier_timeout = Mainloop.timeout_add(
                        200,
                        Lang.bind(this, function() {
                            this._updateBarriers();
                            Mainloop.source_remove(barrier_timeout);
                            return true;
                        }));

            this.thumbnails[i] = new WorkspaceThumbnails.Thumbnails();
            global.overlay_group.add_actor(this.thumbnails[i].actor);

            Schema.bind('display-clock', this.panels[i]._dateMenu.actor, 'visible', Gio.SettingsBindFlags.GET);
            Schema.bind('display-activities', this.panels[i]._activities, 'visible', Gio.SettingsBindFlags.GET);
      
        }

        this.monSigId = Main.layoutManager.connect('monitors-changed', Lang.bind(this, this._updatePanels));
        
    },
    
    _updatePanels : function(){
        this.destroy();
        this._init();
    },
    _updateCorners : function(monIndex){
        let corner = new Layout.HotCorner();
        Main.layoutManager._hotCorners.push(corner);
        corner.actor.set_position(this.monitors[monIndex].x, this.monitors[monIndex].y);
        Main.layoutManager._chrome.addActor(corner.actor);
        this.panels[monIndex]._hotCorner = corner;
    },
    _updateBarriers : function(){
        this._leftPanelBarriers = [];
        for (let i=0; i < this.monitors.length;i++){
            if (i == this.primaryIndex)
                continue;

            if (this._leftPanelBarriers[i] > 0)
                global.destroy_pointer_barrier(this._leftPanelBarriers[i]);
            // this assumes that panels are side-by-side, probably should check this and set dir=1 if not
            let monitor = this.monitors[i];
            this._leftPanelBarriers[i] =
                global.create_pointer_barrier(monitor.x, monitor.y,
                                              monitor.x, monitor.y + this.panelBoxes[i].height,
                                              0 /*block in both X directions*/);
        }
    },
    destroy : function(){

        for (let i = 0; i < this.panels.length; i++) {
            if (i == this.primaryIndex)
                continue;

            this.panels[i].actor.destroy();
            this.panelBoxes = null;

            if (this._leftPanelBarriers[i] > 0)
                global.destroy_pointer_barrier(this._leftPanelBarriers[i]);
            
            this.panels[i]._hotCorner.actor.destroy();
        }
        Main.layoutManager.disconnect(this.monSigId);
    }
});


const HijackPanelButton = new Lang.Class({
    Name: 'HijackPanelButton',

    _init: function(){
        //might need to add timer here, to run initial update after shell startup.

        //target monitor for moving icons
        let monitors = Main.layoutManager.monitors;
        let primaryIndex = Main.layoutManager.primaryIndex;
        
        for (let i = 0; i < monitors.length; i++) {
            if (i == primaryIndex)
                continue;
            this.iconTarget = i;
            break;
        }

        //connect to settings
        this.messageId = ExtensionSystem.connect('extension-state-changed',
                                Lang.bind(this, this._updateIcons));

        this.settingsId = Schema.connect('changed::available-list',
                                Lang.bind(this, this._reorderIcons));
        
        this.wmIcons = [];
        this.icons = [];
    },
    _updateIcons: function(obj,extension){

        this.icons.push(extension);
        if (extension.state == ExtensionSystem.ExtensionState.ENABLED){

            //we have no way of determing which icons belong to an extension
            //so we just scan all non-system icons
            this._moveStatusIcon();
        } else if (extension.state == ExtensionSystem.ExtensionState.DISABLED){
            this.wmIcons = [];
            this._moveStatusIcon();
        }
        
    },
    _reorderIcons: function(){

        //this.wmIcons = [];
        this._returnIcons();
        this._moveIcons();
    },
    
    _moveStatusIcon: function(){

        this._findIcons();
        this._moveIcons();
    },
    _moveIcons: function(){
        let statusArea = Main.panel._statusArea;

        let containers = ['_leftBox','_centerBox','_rightBox'];
        let available = Schema.get_strv('available-list');
        //this.wmIcons = [];
        for (let i in available){
            let icon = available[i];

            let o = statusArea[icon];
            if (o && !this._isBlackList(icon) && this.wmIcons.indexOf(icon) == -1){
                this.wmIcons.push(icon)

                for (let j in containers){
                    let box = containers[j]
                    
                    if (Main.panel[box] == o.actor.get_parent()){
                        let target = Main.__eP.panels[this.iconTarget][box];
                        //find index to insert at
                        let idx = parseInt(i);
                        for (let next = idx+1; next <= available.length; next++){
                            let next_o = statusArea[available[next]];
                            let temp_index = (next_o)?target.get_children().indexOf(next_o.actor):-1;

                            if ( temp_index != -1){
                                idx = temp_index ;
                                break;
                            } else if (next == available.length){
                                idx = target.get_children().length;
                            }

                        }

                        Main.panel[box].remove_actor(o.actor);
                        Main.__eP.panels[this.iconTarget][box].insert_child_at_index(o.actor,idx);
                    }
                } 
            }
        }
    },
    _findIcons: function(){
        
        let statusArea = Main.panel._statusArea;
        let sysIcons = Main.panel._status_area_order;
        
        for (let i in statusArea){
            if (!this._isBlackList(i) && sysIcons.indexOf(i) == -1 ){   
                this._updateAvailable(i);
            }
        }
    },
    _updateAvailable: function(icon){
        let changed = false;
        let available = Schema.get_strv('available-list');

        if (available.indexOf(icon) == -1){
            available.push(icon);
            changed = true;
        }
            //save available extensions/widgets into the schema.
        if (changed)
            Schema.set_strv('available-list', available);
    },
    _isBlackList: function(icon){
        let blackList = Schema.get_strv('black-list');
        return (blackList.indexOf(icon) != -1)?true:false;
    },
    _returnIcons: function(){
        //return in hijack icons to primary panel 
        let containers = ['_leftBox','_centerBox','_rightBox'];
        for (let i in this.wmIcons){

                let o = Main.panel._statusArea[this.wmIcons[i]];
                for (let j in containers){
                        if (Main.__eP.panels[this.iconTarget][containers[j]] == o.actor.get_parent()){
                            log("restoring");
                            Main.__eP.panels[this.iconTarget][containers[j]].remove_actor(o.actor);
                            Main.panel[containers[j]].add_actor(o.actor);
                        }
                }
            }
        this.wmIcons = [];
    },
    destroy: function(){
        ExtensionSystem.disconnect(this.messageId);
        Schema.disconnect(this.settingsId);

        this._returnIcons();
        
    }
});

const NewAppMenuButton = new Lang.Class({
    Name: 'NewAppMenuButton',
    Extends: Panel.AppMenuButton,

    _init: function(monitorIndex){
        this.parent(Main.panel._menus);
        this.monitorIndex = monitorIndex;
        this.lastFocusedApp = Shell.WindowTracker.get_default().focus_app;
        this.grabSigId = global.display.connect('grab-op-end', Lang.bind(this, this._sync));
        Schema.bind('display-appmenu', this.actor, 'visible', Gio.SettingsBindFlags.GET);

    },
    _getPointerMonitor: function() {
        let monitors = Main.layoutManager.monitors;
        [x, y, mod] = global.get_pointer();
        for (let j =0; j < monitors.length; j++){
            if ( x > monitors[j].x && x < (monitors[j].x + monitors[j].width) && 
                 y > monitors[j].y && (monitors[j].y + monitors[j].height)){
                    return j;
            }
        }
        return -1;
        
    },
    _onAppStateChanged: function(appSys, app) {
        let state = app.state;

        if (state != Shell.AppState.STARTING) {
            this._startingApps = this._startingApps.filter(function(a) {
                return a != app;
        });
        } else if (state == Shell.AppState.STARTING && this.monitorIndex == this._getPointerMonitor() ) {
            this._startingApps.push(app);
        }
        // For now just resync on all running state changes; this is mainly to handle
        // cases where the focused window's application changes without the focus
        // changing.  An example case is how we map OpenOffice.org based on the window
        // title which is a dynamic property.
        this._sync();
    },
    //mostly copied from the shell appMenu Code
    _sync: function() {
        let tracker = Shell.WindowTracker.get_default();
        let focusedApp = tracker.focus_app;

        
        let lastStartedApp = null;
        let workspace = global.screen.get_active_workspace();
        for (let i = 0; i < this._startingApps.length; i++)
            if (this._startingApps[i].is_on_workspace(workspace))
                lastStartedApp = this._startingApps[i];

        let targetApp = focusedApp != null ? null : lastStartedApp;
    
        //find last used app window
        if (targetApp == null) {
            let tracker = Shell.WindowTracker.get_default();
            let screen = global.screen;
            let display = screen.get_display();
            let windows = display.get_tab_list(Meta.TabList.NORMAL_ALL, screen,
                                           screen.get_active_workspace());

            for (let i = 0; i < windows.length; i++){           
        
                if (windows[i].get_monitor() == this.monitorIndex){
                    targetApp = tracker.get_window_app(windows[i]);
                    break;
                }
            };
        }

        if (targetApp == null) {
            if (!this._targetIsCurrent)
                return;

            this.actor.reactive = false;
            this._targetIsCurrent = false;

            Tweener.removeTweens(this.actor);
            Tweener.addTween(this.actor, { opacity: 0,
                                           time: Overview.ANIMATION_TIME,
                                           transition: 'easeOutQuad' });
            return;
        }

        if (!targetApp.is_on_workspace(workspace))
            return;

        if (!this._targetIsCurrent) {
            this.actor.reactive = true;
            this._targetIsCurrent = true;

            Tweener.removeTweens(this.actor);
            Tweener.addTween(this.actor, { opacity: 255,
                                           time: Overview.ANIMATION_TIME,
                                           transition: 'easeOutQuad' });
        }

        if (targetApp == this._targetApp) {
            if (targetApp && targetApp.get_state() != Shell.AppState.STARTING) {
                this.stopAnimation();
                this._maybeSetMenu();
            }
            return;
        }

        this._spinner.actor.hide();
        if (this._iconBox.child != null)
            this._iconBox.child.destroy();
        this._iconBox.hide();
        this._label.setText('');

        if (this._appMenuNotifyId)
            this._targetApp.disconnect(this._appMenuNotifyId);
        if (this._actionGroupNotifyId)
            this._targetApp.disconnect(this._actionGroupNotifyId);
        if (targetApp) {
            this._appMenuNotifyId = targetApp.connect('notify::menu', Lang.bind(this, this._sync));
            this._actionGroupNotifyId = targetApp.connect('notify::action-group', Lang.bind(this, this._sync));
        } else {
            this._appMenuNotifyId = 0;
            this._actionGroupNotifyId = 0;
        }

        this._targetApp = targetApp;
        let icon = targetApp.get_faded_icon(2 * Panel.PANEL_ICON_SIZE);

        this._label.setText(targetApp.get_name());
        this.setName(targetApp.get_name());

        this._iconBox.set_child(icon);
        this._iconBox.show();

        if (targetApp.get_state() == Shell.AppState.STARTING)
            this.startAnimation();
        else
            this._maybeSetMenu();

        this.emit('changed');
    }
});

function injectToFunction(parent, name, func) {
    let origin = parent[name];
    parent[name] = function() {
        let ret;
        ret = origin.apply(this, arguments);
        if (ret === undefined)
                ret = func.apply(this, arguments);
        return ret;
    }
    return origin;
}

function removeInjection(object, injection, name) {
    if (injection[name] === undefined)
        delete object[name];
    else
        object[name] = injection[name];
}

const workspacesPatch = new Lang.Class({
    Name: 'workspacesPatch',

    _init: function(){
        this.wsDispInjection = {};

        this.wsDispInjection['_updateWorkspacesGeometry'] = injectToFunction(WorkspacesView.WorkspacesDisplay.prototype, '_updateWorkspacesGeometry',
            function() {
                let thisParent = Main.overview._workspacesDisplay;
                
                if (!thisParent._workspacesViews)
                    return;
                
                let panelHeight = Main.panel.actor.height;
                let resWidth = Main.overview._workspacesDisplay._controls.get_width();
                let monitors = Main.layoutManager.monitors;

                let m = 0;

                for (let i = 0; i < monitors.length; i++) {
                    if (i == this._primaryIndex) {
                        m++;
                    }else if (!thisParent._workspacesOnlyOnPrimary && i != thisParent._primaryIndex ) {
                        thisParent._workspacesViews[m].setClipRect(monitors[i].x + resWidth,
                                                                   monitors[i].y + panelHeight,
                                                                   monitors[i].width - resWidth,
                                                                   monitors[i].height - panelHeight);
                        thisParent._workspacesViews[m].setGeometry(monitors[i].x + resWidth,
                                                                   monitors[i].y + panelHeight,
                                                                   monitors[i].width - resWidth ,
                                                                   monitors[i].height - panelHeight, 0);
                        m++;
                    }
                }
        });
        this.wsDispInjection['show'] = injectToFunction(WorkspacesView.WorkspacesDisplay.prototype, 'show',
            function(){
                let monitors = Main.layoutManager.monitors;
                for (let i = 0; i < monitors.length; i++) {
                    if (i != this._primaryIndex) {
                        eP.thumbnails[i]._controls.show();
                        eP.thumbnails[i]._thumbnailsBox.show();
                    }
                }
        });
        this.wsDispInjection['hide'] = injectToFunction(WorkspacesView.WorkspacesDisplay.prototype, 'hide',
            function(){
                let monitors = Main.layoutManager.monitors;
                for (let i = 0; i < monitors.length; i++) {
                    if (i != this._primaryIndex) {
                        eP.thumbnails[i]._controls.hide();
                        eP.thumbnails[i]._thumbnailsBox.hide();
                    }
                }
        });
    },
    destroy: function(){
        for (i in this.wsDispInjection) {
            removeInjection(WorkspacesView.WorkspacesDisplay.prototype, this.wsDispInjection, i);
        }
        this.wsDispInjection = {};

    }

});


function init() {
    //let me = extension.imports.convenience;
    //me.initTranslations(extension);
}

function enable() {
    log("Loading Extra Panels Extension");
    eP = new ExtraPanels();
    Main.__eP = eP;
    eP.workspacePatch = new workspacesPatch();
    eP.hijack = new HijackPanelButton();
    Main.panel._appMenus = [];

    for (let i = 0; i < eP.monitors.length; i++) {  
        let panel;  
            
        if (i == eP.primaryIndex) {
            panel = Main.panel;
        } else {
            panel = eP.panels[i];
        }
        //Replace AppMenu
        panel._appMenu.actor.destroy();

        Main.panel._appMenus[i] = new NewAppMenuButton(i);
        panel._leftBox.add(Main.panel._appMenus[i].actor);
    }
    //emit signal to force initial AppMenu sync
    let tracker = Shell.WindowTracker.get_default();
    //tracker.emit('notify::focus-app', tracker.focus_app);
    tracker.emit('notify::focus-app', null);
    
}


function disable() {
    //Destroy 
    Main.panel._appMenus.forEach(function(appMenu){
        global.display.disconnect(appMenu.grabSigId); 
        appMenu.destroy();
    });
    eP.hijack.destroy();    
    eP.workspacePatch.destroy();
    
    eP.destroy();
        
    // Restore orignal AppMenu
    Main.panel._appMenu = new Panel.AppMenuButton(Main.panel._menus);
    Main.panel._leftBox.add(Main.panel._appMenu.actor);
    Main.panel._appMenus = null;
    Main.__eP = null;


    Schema.run_dispose();

}
