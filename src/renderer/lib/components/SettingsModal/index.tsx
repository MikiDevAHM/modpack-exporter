import React, { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import ProfileSelector from './ProfileSelector';
import { getCachedSetting, setCachedSetting } from '@/lib/utils/settingsCache';
import Modal, { ModalHeader, ModalFooter } from '../base/Modal';
import Button from '../base/Button';
import Input, { LABEL_CLASSES } from '../base/Input';
import IconButton from '../base/IconButton';

interface Props {
  /** When false, the close button and overlay-click dismiss are hidden. */
  dismissible?: boolean;
  /** Closes the modal. */
  onClose: () => void;
  /** Called after Save. The parent should refresh state. */
  onSaved: () => void;
  /** If true, show a "Skip" button that closes without saving. */
  showSkip?: boolean;
}

export default function SettingsModal({
  dismissible = true,
  onClose,
  onSaved,
  showSkip = false,
}: Props) {
  const [modpackRoot, setModpackRoot] = useState('');
  const [exportDir, setExportDir] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setExportDir(getCachedSetting('exportDir'));
    setModpackRoot(getCachedSetting('modpackRoot'));

    window.electron.modpack.onRootFound(({ path: p }) => {
      setModpackRoot(prev => prev || p);
    });
    return () => window.electron.modpack.offRootFound();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProfileSelected = (path: string, profileName?: string) => {
    setModpackRoot(path);
    toast.success(profileName ? `Profile "${profileName}" selected` : `Modpack root set to ${path}`);
  };

  const selectExportDir = async () => {
    const dir = await window.electron.app.selectDirectory();
    if (dir) setExportDir(dir);
  };

  const handleSave = async () => {
    if (!modpackRoot.trim()) {
      toast.error('Modpack root is required');
      return;
    }
    setIsSaving(true);
    await Promise.all([
      setCachedSetting('modpackRoot', modpackRoot.trim()),
      setCachedSetting('exportDir', exportDir.trim()),
    ]);
    setIsSaving(false);
    toast.success('Settings saved');
    onSaved();
  };

  const handleSkip = () => {
    toast('You can configure this later in Settings', { icon: '\u2699\uFE0F' });
    onClose();
  };

  return (
    <Modal open onClose={onClose} dismissible={dismissible} widthClass="w-[500px]">
      <ModalHeader onClose={dismissible ? onClose : undefined}>
        <h2 className="text-foreground font-semibold text-base">Welcome to ORB Modpack Exporter</h2>
      </ModalHeader>

      <div className="p-5 flex flex-col gap-5 overflow-y-auto flex-1">
        <div>
          <label className={LABEL_CLASSES}>
            Modpack Root Directory <span className="text-brand">*</span>
          </label>
          <p className="text-muted text-xs mb-2">
            Detected from every major launcher on this machine (must contain a{' '}
            <code className="bg-line/10 px-1 rounded">mods/</code> subfolder), or pick one manually.
          </p>
          <ProfileSelector selectedPath={modpackRoot} onSelected={handleProfileSelected} />
        </div>

        <div>
          <label className={LABEL_CLASSES}>
            Export Directory <span className="text-muted font-normal">(optional)</span>
          </label>
          <p className="text-muted text-xs mb-2">
            Where <code className="bg-line/10 px-1 rounded">.mrpack</code> files are saved.
            Defaults to <code className="bg-line/10 px-1 rounded">modpack_root/Modpack Export/</code>.
          </p>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                value={exportDir}
                onChange={e => setExportDir(e.target.value)}
                placeholder="Leave blank for default"
              />
            </div>
            <IconButton
              icon={FolderOpen}
              label="Browse"
              variant="secondary"
              sizeClass="px-3 py-2"
              onClick={selectExportDir}
            />
          </div>
        </div>
      </div>

      <ModalFooter>
        <div className="mr-auto">
          {showSkip && (
            <Button variant="ghost" onClick={handleSkip}>
              Skip, I'll configure later
            </Button>
          )}
        </div>
        {dismissible && !showSkip && (
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        )}
        <Button
          variant="primary"
          loading={isSaving}
          disabled={!modpackRoot.trim()}
          onClick={handleSave}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
