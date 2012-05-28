## Multiple Monitor Panels

Gnome-shell extension that adds top panels including a monitor specific AppMenu to each additional monitor. It also provides support for moving icons/widgets that are created by other extensions onto the secondary monitor.

![](http://i.imgur.com/nUuBc.png)

### Install: 
One Click Install via [extensions.gnome.org](https://extensions.gnome.org/extension/323/multiple-monitor-panels/)

### Icon Moving Support:
For Icon moving to work, it requires that the extension adds icon/widget to the panel using the Panel.addToStatusArea API. In the case the extension does not do this, its possible to fake support by adding a reference to the panel. It requires adding the following 2 lines to that extensions.

enable():
	Main.panel._statusArea.extensionName = [PanelMenuButton object];
disable():
	Main.panel._statusArea.extensionName = null;

### Author:
[darkxst](https://github.com/darkxst)
