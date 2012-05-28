// -*- mode: js2; indent-tabs-mode: nil; js2-basic-offset: 4 -*-
// adapted from workspace-switcher extensions.
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;


//const Gettext = imports.gettext.domain('gnome-shell-extensions');
const Gettext = imports.gettext.domain('multiple-monitor-panels');
const _ = Gettext.gettext;
const N_ = function(e) { return e };

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

const EXTRA_SCHEMA = 'org.gnome.shell.extensions.extra-panels';
const AVAILABLE_KEY = 'available-list';
const BLACKLIST_KEY = 'black-list';

const IconOrderModel = new GObject.Class({
    Name: 'ExtraPanels.IconOrderModel',
    GTypeName: 'IconOrderModel',
    Extends: Gtk.ListStore,

    Columns: {
        LABEL: 0,
    },

    _init: function(params) {
        this.parent(params);
        this.set_column_types([GObject.TYPE_STRING]);


        this._settings = Convenience.getSettings();
        //this._settings.connect('changed::workspace-names', Lang.bind(this, this._reloadFromSettings));

        this._reloadFromSettings();

        // overriding class closure doesn't work, because GtkTreeModel
        // plays tricks with marshallers and class closures
        this.connect('row-changed', Lang.bind(this, this._onRowChanged));
        this.connect('row-inserted', Lang.bind(this, this._onRowInserted));
        this.connect('row-deleted', Lang.bind(this, this._onRowDeleted));
    },

    _reloadFromSettings: function() {
        if (this._preventChanges)
            return;
        this._preventChanges = true;

        let newNames = this._settings.get_strv(AVAILABLE_KEY);
        let _blackList = this._settings.get_strv(BLACKLIST_KEY);

        let i = 0;
        let [ok, iter] = this.get_iter_first();
        while (ok && i < newNames.length ) {
            if (_blackList.indexOf(newNames[i]) == -1) {
                this.set(iter, [this.Columns.LABEL], [newNames[i]]);
                ok = this.iter_next(iter);
            }
            i++;
        }

        while (ok)
            ok = this.remove(iter);

        for ( ; i < newNames.length; i++) {
            if (_blackList.indexOf(newNames[i]) == -1) {
                iter = this.append();
                this.set(iter, [this.Columns.LABEL], [newNames[i]]);
            }
        }

        this._preventChanges = false;
    },

    _onRowChanged: function(self, path, iter) {
        if (this._preventChanges)
            return;
        this._preventChanges = true;

        let index = path.get_indices()[0];
        let names = this._settings.get_strv(AVAILABLE_KEY);

        if (index >= names.length) {
            // fill with blanks
            for (let i = names.length; i <= index; i++)
                names[i] = '';
        }

        names[index] = this.get_value(iter, this.Columns.LABEL);

        this._settings.set_strv(AVAILABLE_KEY, names);

        this._preventChanges = false;
    },

    _onRowInserted: function(self, path, iter) {
        if (this._preventChanges)
            return;
        this._preventChanges = true;

        let index = path.get_indices()[0];
        let names = this._settings.get_strv(AVAILABLE_KEY);
        let label = this.get_value(iter, this.Columns.LABEL) || '';
        names.splice(index, 0, label);

        this._settings.set_strv(AVAILABLE_KEY, names);

        this._preventChanges = false;
    },

    _onRowDeleted: function(self, path) {
        if (this._preventChanges)
            return;
        this._preventChanges = true;

        let index = path.get_indices()[0];
        let names = this._settings.get_strv(AVAILABLE_KEY);

        if (index >= names.length)
            return;

        names.splice(index, 1);

        // compact the array
        for (let i = names.length -1; i >= 0 && !names[i]; i++)
            names.pop();

        this._settings.set_strv(AVAILABLE_KEY, names);

        this._preventChanges = false;
    }
    
});

const SettingsWidget = new GObject.Class({
    Name: 'ExtraPanels.SettingsWidget',
    GTypeName: 'SettingsWidget',
    Extends: Gtk.Grid,

    _init: function(params) {
        this._store = new IconOrderModel();
        this._settings = this._store._settings;

        this.parent(params);
        this.margin = 10;
        this.orientation = Gtk.Orientation.VERTICAL;

        this.add(new Gtk.Label({ label: _("Options:"),
                                 margin_bottom: 5,
                                 xalign: 0
                                 /*justify: Gtk.Justification.LEFT*/
                             }));
        let clock = new Gtk.CheckButton({   label:_('Display Clock'),
                                            margin: 5});
        this.add(clock);
        this._settings.bind('display-clock', clock, 'active', Gio.SettingsBindFlags.DEFAULT);

        let activities = new Gtk.CheckButton({  label:_('Display Activities'),
                                                margin: 5
                                            });
        this.add(activities);
        this._settings.bind('display-activities', activities, 'active', Gio.SettingsBindFlags.DEFAULT);

        let appmenu = new Gtk.CheckButton({  label:_('Display App Menus'),
                                                margin_left: 5,
                                                /*margin_top: 5,*/
                                                margin_bottom: 20
                                            });
        this.add(appmenu);
        this._settings.bind('display-appmenu', appmenu, 'active', Gio.SettingsBindFlags.DEFAULT);

        let seperator = new Gtk.HSeparator();
        this.add(seperator);

        let hBox = new Gtk.HBox();

        hBox.add(new Gtk.Label({ label: _("Move Icons:"),
                                 margin_bottom: 5,
                                 margin_top: 10,
                                 xalign: 0
                                 }));
        hBox.add(new Gtk.Label({ label: _("(drag to re-order)"),
                                 margin_bottom: 5,
                                 margin_top: 10,
                                 xalign: 1
                                 }));
        this.add(hBox);


        
        this._treeView = new Gtk.TreeView({ model: this._store,
                                            headers_visible: false,
                                            reorderable: true,
                                            hexpand: true,
                                            vexpand: true
                                          });

        let column = new Gtk.TreeViewColumn({ title: _("Name") });
        let renderer = new Gtk.CellRendererText({ editable: false });
        //renderer.connect('edited', Lang.bind(this, this._cellEdited));
        column.pack_start(renderer, true);
        column.add_attribute(renderer, 'text', this._store.Columns.LABEL);
        this._treeView.append_column(column);

        this.add(this._treeView);

        let toolbar = new Gtk.Toolbar();
        toolbar.get_style_context().add_class(Gtk.STYLE_CLASS_INLINE_TOOLBAR);

        let newButton = new Gtk.ToolButton({ stock_id: Gtk.STOCK_NEW });
        newButton.connect('clicked', Lang.bind(this, this._newClicked));
        toolbar.add(newButton);

        let delButton = new Gtk.ToolButton({ stock_id: Gtk.STOCK_DELETE });
        delButton.connect('clicked', Lang.bind(this, this._delClicked));
        toolbar.add(delButton);

        /*let moveDownButton = new Gtk.ToolButton({ stock_id: Gtk.STOCK_GO_DOWN });
        moveDownButton.connect('clicked', Lang.bind(this, this._moveDown));
        toolbar.add(moveDownButton);

        let moveUpButton = new Gtk.ToolButton({ stock_id: Gtk.STOCK_GO_UP });
        moveUpButton.connect('clicked', Lang.bind(this, this._moveUp));
        toolbar.add(moveUpButton);*/

        this.add(toolbar);
    },
    
    //popup a dialog showing items in black-list.
    _newClicked: function() {

        if (this._store._preventChanges)
            return;
        this._store._preventChanges = true;

        const Columns = {
            NAME: 0
        };
        //dialog to add a new icon to list
        //display contents of available-list
        let dialog = new Gtk.Dialog({ title: _("Select Widget"),
                                      transient_for: this.get_toplevel(),
                                      modal: true });
        dialog.add_button(Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL);
        dialog.add_button(_("Add"), Gtk.ResponseType.OK);
        dialog.set_default_response(Gtk.ResponseType.OK);
        dialog.set_default_geometry(100,200);
        dialog._list = new Gtk.ListStore();
        dialog._list.set_column_types([GObject.TYPE_STRING]);

        let _blackList = this._settings.get_strv(BLACKLIST_KEY);
        
        for (let i in _blackList){
            let iter = dialog._list.append();
            dialog._list.set(iter, [Columns.NAME], [_blackList[i]]);
        }

        dialog._treeView = new Gtk.TreeView({   model: dialog._list,
                                                /*headers_visible: false,*/
                                                hexpand: true,
                                                vexpand: true
                                        });
        dialog._treeView.get_selection().set_mode(Gtk.SelectionMode.SINGLE);
        
        let column = new Gtk.TreeViewColumn({ title: _("Icon Name") });
        let renderer = new Gtk.CellRendererText({ editable: false });
        column.pack_start(renderer, true);
        column.add_attribute(renderer, "text", Columns.NAME);

        dialog._treeView.append_column(column);

        dialog.get_content_area().add(dialog._treeView);

        dialog.connect('response', Lang.bind(this, function(dialog, id) {
            if (id != Gtk.ResponseType.OK) {
                dialog.destroy();
                return;
            }

            let [any, model, iter] = dialog._treeView.get_selection().get_selected();
            log (any);
            if(any){
                let newWidget = dialog._list.get_value(iter, Columns.NAME);
                let iter2 = this._store.append()
                this._store.set(iter2, [this._store.Columns.LABEL], [newWidget]);

                _blackList = _blackList.filter(function(a){ return a != newWidget});

                this._settings.set_strv(BLACKLIST_KEY,_blackList);

                dialog.destroy();
            }
        
        }));

        dialog.show_all();
        this._store._preventChanges = false;
    },

    _delClicked: function() {
        let [any, model, iter] = this._treeView.get_selection().get_selected();

        if (any) {
            
            //add to blacklist
            let blackList = this._store._settings.get_strv(BLACKLIST_KEY);
            let item = this._store.get_value(iter, this._store.Columns.LABEL);

            if (blackList.indexOf(item) == -1){
                blackList.push(item);
                this._store._settings.set_strv(BLACKLIST_KEY, blackList);
            }
         
            this._store.remove(iter);
        }
    }
});

function init() {
    Convenience.initTranslations();
}

function buildPrefsWidget() {
    let widget = new SettingsWidget();
    widget.show_all();

    return widget;
}
