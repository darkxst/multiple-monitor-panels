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

const Panel = imports.ui.panel;
const Main = imports.ui.main;
const Lang = imports.lang;

const Shell = imports.gi.Shell;
const Tweener = imports.ui.tweener;
const Overview = imports.ui.overview;
const Meta = imports.gi.Meta;
const Layout = imports.ui.layout;
const Mainloop = imports.mainloop;

const St = imports.gi.St;



let panels;

const ExtraPanels = new Lang.Class({
    Name: 'ExtraPanels',

    _init : function() {
        this.monitors = Main.layoutManager.monitors;
        this.primaryIndex = Main.layoutManager.primaryIndex;
        this.panelBoxes = [];
        this.panels = [];
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
            this.panels[i]._activitiesButton._hotCorner.actor.set_position(this.monitors[i].x, this.monitors[i].y);
            this._updateCorners(i);
            let barrier_timeout = Mainloop.timeout_add(
                        200,
                        Lang.bind(this, function() {
                            this._updateBarriers();
                            Mainloop.source_remove(barrier_timeout);
                            return true;
                        }));
        }

        this.monSigId = Main.layoutManager.connect('monitors-changed', Lang.bind(this, this._updatePanels));
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



function init() {

    /*do nothing*/
}

function enable() {
    log("Loading Extra Panels Extension");
    let eP = new ExtraPanels();
    Main.__eP = eP;
    Main.panel._appMenus = [];

    for (let i = 0; i < eP.monitors.length; i++) {  
        let panel;  
            
        if (i == eP.primaryIndex) {
            panel = Main.panel;
        } else {
            panel = Main.__eP.panels[i];
        }
        //Replace AppMenu
        panel._appMenu.actor.destroy();

        Main.panel._appMenus[i] = new NewAppMenuButton(i);
        panel._leftBox.add(Main.panel._appMenus[i].actor);
    }
    //emit signal to force initial AppMenu sync
    let tracker = Shell.WindowTracker.get_default();
    tracker.emit('notify::focus-app', tracker.focus_app);
}

function disable() {
    //Destroy 
    Main.panel._appMenus.forEach(function(appMenu){
        global.display.disconnect(appMenu.grabSigId); 
        appMenu.destroy();
    });    
    
    Main.__eP.destroy();
        
    // Restore orignal AppMenu
    Main.panel._appMenu = new Panel.AppMenuButton(Main.panel._menus);
    Main.panel._leftBox.add(Main.panel._appMenu.actor);
    Main.panel._appMenus = null;
    Main.__eP = null;

}
