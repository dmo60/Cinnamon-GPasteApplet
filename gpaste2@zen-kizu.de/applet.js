//const StatusIconDispatcher = imports.ui.statusIconDispatcher;
const Main        = imports.ui.main;
//const Panel = imports.ui.panel;
const Lang        = imports.lang;
const St          = imports.gi.St;
const Gio         = imports.gi.Gio;
const Pango       = imports.gi.Pango;
//const PanelMenu = imports.ui.panelMenu;
const PopupMenu   = imports.ui.popupMenu;
const Gettext     = imports.gettext;
const Applet      = imports.ui.applet;

const _           = Gettext.domain('GPaste').gettext;
const BUS_NAME    = 'org.gnome.GPaste';
const OBJECT_PATH = '/org/gnome/GPaste';

const GPasteInterface =
    '<node>\
        <interface name="org.gnome.GPaste">\
            <method name="GetHistory">\
                <arg type="as" direction="out" />\
            </method>\
            <method name="Select">\
                <arg type="u" direction="in" />\
            </method>\
            <method name="Delete">\
                <arg type="u" direction="in" />\
            </method>\
            <method name="Empty" />\
            <method name="Track">\
                <arg type="b" direction="in" />\
            </method>\
            <method name="OnExtensionStateChanged">\
                <arg type="b" direction="in" />\
            </method>\
            <signal name="Changed" />\
            <signal name="ToggleHistory" />\
            <signal name="Tracking">\
                <arg type="b" direction="out" />\
            </signal>\
            <property name="Active" type="b" access="read" />\
        </interface>\
    </node>';
const GPasteProxy = Gio.DBusProxy.makeProxyWrapper(GPasteInterface);


function MyMenu(launcher, orientation) {
    this._init(launcher, orientation);
}

MyMenu.prototype = {
    __proto__: PopupMenu.PopupMenu.prototype,

    _init: function(launcher, orientation) {
        this._launcher = launcher;        

        PopupMenu.PopupMenu.prototype._init.call(this, launcher.actor, 0.0, orientation, 0);
        Main.uiGroup.add_actor(this.actor);
        this.actor.hide();            
    }
};

const HistoryMenuItemAction = {
    DEFAULT: 0,
    DELETE:  1
}

function HistoryMenuItem(place) {
    this._init(place);
}

HistoryMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(text) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this);

        this.label                         = new St.Label({ text: text });
        this.label.clutter_text.max_length = 60;
        this.label.clutter_text.ellipsize  = Pango.EllipsizeMode.END;
        this.addActor(this.label);

        let deleteIcon   = new St.Icon({ icon_name:   'edit-delete',
                                         icon_type:   St.IconType.SYMBOLIC,
                                         style_class: 'popup-menu-icon ' });
        let deleteButton = new St.Button({ child: deleteIcon });
        deleteButton.connect('clicked', Lang.bind(this, this._delete));
        this.addActor(deleteButton, { expand: false, span: -1, align: St.Align.END });
    },

    _delete: function() {
        this.action = HistoryMenuItemAction.DELETE;

        PopupMenu.PopupBaseMenuItem.prototype.activate.call(this, null);
    },

    activate: function(event) {
        this.action = HistoryMenuItemAction.DEFAULT;

        PopupMenu.PopupBaseMenuItem.prototype.activate.call(this, event);
    },

    updateText: function(text) {
        this.label.set_text(text);
    }
};

function GPasteApplet(orientation) {
    this._init(orientation);
}

GPasteApplet.prototype = {
    __proto__: Applet.IconApplet.prototype,

    _init: function(orientation) {
        Applet.IconApplet.prototype._init.call(this, orientation);

        try {
            this.set_applet_icon_symbolic_name("edit-paste");
            this.set_applet_tooltip(_("GPaste clipboard"));

            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu        = new MyMenu(this, orientation);
            this.menuManager.addMenu(this.menu);

            this._killSwitch = new PopupMenu.PopupSwitchMenuItem(_("Track changes"), true);
            this._killSwitch.connect('toggled', Lang.bind(this, this._toggleDaemon));

            this._proxy = new GPasteProxy(Gio.DBus.session, BUS_NAME, OBJECT_PATH);
            this._proxy.connectSignal('Changed', Lang.bind(this, this._updateHistory));
            this._proxy.connectSignal('ToggleHistory', Lang.bind(this, this._toggleHistory));
            this._proxy.connectSignal('Tracking', Lang.bind(this, function(proxy, sender, [trackingState]) {
                this._trackingStateChanged(trackingState);
            }));

            this._createHistory();
            this._noHistory = new PopupMenu.PopupMenuItem("");
            this._noHistory.setSensitive(false);
            this._emptyHistory = new PopupMenu.PopupMenuItem(_("Empty history"));
            this._emptyHistory.connect('activate', Lang.bind(this, this._empty));
            this._fillMenu();
        }
        catch (e) {
            global.logError(e);
        };
    },

    on_applet_clicked: function(event) {
        this.menu.toggle();        
    },

    _select: function(index) {
        this._proxy.SelectRemote(index);
    },

    _delete: function(index) {
        this._proxy.DeleteRemote(index);
    },

    _empty: function() {
        this._proxy.EmptyRemote();
    },

    _trackingStateChanged: function(trackingState) {
        this._killSwitch.setToggleState(trackingState);
    },

    _toggleDaemon: function() {
        this._proxy.TrackRemote(this._killSwitch.state);
    },

    _fillMenu: function() {
        let active = this._proxy.Active;
        if (active != null) {
            this._killSwitch.setToggleState(active);
        }
        this.menu.addMenuItem(this._killSwitch);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._addHistoryItems();
        this.menu.addMenuItem(this._noHistory);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this._emptyHistory);
        this.menu.addCommandlineAction(_("GPaste daemon settings"), '/usr/lib/gpaste/gpaste-settings');
        this._updateHistory();
    },

    _updateHistory: function() {
        this._proxy.GetHistoryRemote(Lang.bind(this, function(result, err) {
            let [history] = err ? [null] : result;
            if (history != null && history.length != 0) {
                let limit = Math.min(history.length, this._history.length);
                for (let index = 0; index < limit; ++index) {
                    this._updateHistoryItem(index, history[index]);
                }
                this._hideHistory(limit);
                this._noHistory.actor.hide();
                this._emptyHistory.actor.show();
            } else {
                this._noHistory.label.text = (history == null) ? _("(Couldn't connect to GPaste daemon)") : _("(Empty)");
                this._hideHistory();
                this._emptyHistory.actor.hide();
                this._noHistory.actor.show();
            }
        }));
    },

    _toggleHistory: function() {
        this.menu.toggle();
    },

    _createHistoryItem: function(index) {
        let item = new HistoryMenuItem("");
        item.actor.set_style_class_name('popup-menu-item');
        item.connect('activate', Lang.bind(this, function(actor, event) {
            if (item.action == HistoryMenuItemAction.DEFAULT) {
                this._select(index);
                return false;
            } else {
                this._delete(index);
                return true;
            }
        }));
        return item;
    },

    _createHistory: function() {
        this._history = [];
        for (let index = 0; index < 20; ++index) {
            this._history[index] = this._createHistoryItem(index);
        }
        this._history[0].actor.set_style("font-weight: bold;");
    },

    _addHistoryItems: function() {
        for (let index = 0; index < this._history.length; ++index) {
            this.menu.addMenuItem(this._history[index]);
        }
    },

    _updateHistoryItem: function(index, element) {
        this._history[index].updateText(element.replace(/\n/g, ' '));
        this._history[index].actor.show();
    },

    _hideHistory: function(startIndex) {
        for (let index = startIndex || 0; index < this._history.length; ++index) {
            this._history[index].actor.hide();
        }
    },

    _onStateChanged: function (state) {
        this._proxy.OnExtensionStateChangedRemote(state);
    }
};

function main(metadata, orientation) {  
    let applet = new GPasteApplet(orientation);
    return applet;      
};

