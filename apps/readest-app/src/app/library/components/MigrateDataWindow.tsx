import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import {
  RiFolderOpenLine,
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiLoader2Line,
} from 'react-icons/ri';
import { documentDir, join } from '@tauri-apps/api/path';
import { relaunch } from '@tauri-apps/plugin-process';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { DATA_SUBDIR, SETTINGS_FILENAME } from '@/services/constants';
import { FileItem } from '@/types/system';
import { getDirPath } from '@/utils/path';
import { formatBytes } from '@/utils/book';
import { getOSPlatform } from '@/utils/misc';
import { getExternalSDCardPath, selectDirectory as selectAndroidDirectory } from '@/utils/bridge';
import { FILE_REVEAL_LABELS, FILE_REVEAL_PLATFORMS } from '@/utils/os';
import { requestStoragePermission } from '@/utils/permission';
import Dialog from '@/components/Dialog';
import Dropdown from '@/components/Dropdown';
import MenuItem from '@/components/MenuItem';

export const setMigrateDataDirDialogVisible = (
  visible: boolean,
  options?: { mode?: DataLocationMode; newDataDir?: string },
) => {
  const dialog = document.getElementById('migrate_data_dir_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible, ...options },
    });
    dialog.dispatchEvent(event);
  }
};

type MigrationStatus = 'idle' | 'selecting' | 'migrating' | 'completed' | 'error';
type DataLocationMode = 'migrate' | 'connect';

interface MigrationProgress {
  current: number;
  total: number;
  currentFile?: string;
}

interface ExistingDataMatch {
  rootDir: string;
  dataDir: string;
}

export const MigrateDataWindow = () => {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const { setLibrary } = useLibraryStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<DataLocationMode>('migrate');
  const [currentDataDir, setCurrentDataDir] = useState('');
  const [newDataDir, setNewDataDir] = useState('');
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus>('idle');
  const [migrationProgress, setMigrationProgress] = useState<MigrationProgress>({
    current: 0,
    total: 0,
  });
  const [errorMessage, setErrorMessage] = useState('');
  const [filesToMigrate, setFilesToMigrate] = useState<FileItem[]>([]);
  const [currentDirFileCount, setCurrentDirFileCount] = useState('');
  const [currentDirFileSize, setCurrentDirFileSize] = useState(0);
  const [androidNewDirs, setAndroidNewDirs] = useState<{ path: string; label: string }[]>([]);

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
      if (event.detail.visible) {
        setMode(event.detail.mode || 'migrate');
        setNewDataDir(event.detail.newDataDir || '');
        setMigrationStatus('idle');
        setErrorMessage('');
        setMigrationProgress({ current: 0, total: 0 });
        loadCurrentDataDir();
        loadAndroidDirs();
      }
    };

    const el = document.getElementById('migrate_data_dir_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadCurrentDataDir = async () => {
    try {
      if (!appService) return;

      const dataDir = await appService.resolveFilePath('', 'Data');
      setCurrentDataDir(dataDir);
      const files = await appService.readDirectory(dataDir, 'None');
      setFilesToMigrate(files);
      setCurrentDirFileCount(files.length.toLocaleString());
      setCurrentDirFileSize(files.reduce((acc, file) => acc + file.size, 0));
    } catch (error) {
      console.error('Error loading current data directory:', error);
    }
  };

  const loadAndroidDirs = async () => {
    try {
      if (appService?.isAndroidApp) {
        const sdCardPathResponse = await getExternalSDCardPath();
        let sdcardDirs = [
          { path: '/storage/emulated/0', label: '/sdcard/0' },
          { path: '/storage/emulated/0/Books', label: '/sdcard/0/Books' },
          { path: '/storage/emulated/0/Documents', label: '/sdcard/0/Documents' },
          { path: '/storage/emulated/0/Download', label: '/sdcard/0/Download' },
        ];
        if (sdCardPathResponse.path) {
          const externalSdCardPath = sdCardPathResponse.path;
          sdcardDirs = [
            ...sdcardDirs,
            { path: externalSdCardPath, label: '/sdcard/1' },
            { path: `${externalSdCardPath}/Books`, label: '/sdcard/1/Books' },
            { path: `${externalSdCardPath}/Documents`, label: '/sdcard/1/Documents' },
            { path: `${externalSdCardPath}/Download`, label: '/sdcard/1/Download' },
          ];
        }
        const localDocumentDir = await documentDir();
        setAndroidNewDirs([
          // For Google Play version we won't request permission to access root of /sdcard
          ...(appService?.distChannel === 'playstore' ? [] : sdcardDirs),
          { path: localDocumentDir, label: '/sdcard/APPDATA/Documents' },
        ]);
      }
    } catch (error) {
      console.error('Error loading app local data directory:', error);
    }
  };

  const findExistingDataMatch = async (selectedDir: string): Promise<ExistingDataMatch | null> => {
    if (!appService) return null;

    const directLibraryPath = await join(selectedDir, 'Books');
    const directLibraryFile = await join(directLibraryPath, 'library.json');
    const directSettingsFile = await join(selectedDir, SETTINGS_FILENAME);
    if ((await appService.exists(directLibraryFile, 'None')) ||
        (await appService.exists(directSettingsFile, 'None'))) {
      return {
        rootDir: getDirPath(selectedDir),
        dataDir: selectedDir,
      };
    }

    const nestedDataDir = await join(selectedDir, DATA_SUBDIR);
    const nestedLibraryPath = await join(nestedDataDir, 'Books');
    const nestedLibraryFile = await join(nestedLibraryPath, 'library.json');
    const nestedSettingsFile = await join(nestedDataDir, SETTINGS_FILENAME);
    if ((await appService.exists(nestedLibraryFile, 'None')) ||
        (await appService.exists(nestedSettingsFile, 'None'))) {
      return {
        rootDir: selectedDir,
        dataDir: nestedDataDir,
      };
    }

    return null;
  };

  const handleSelectNewDir = async () => {
    setMigrationStatus('selecting');
    setErrorMessage('');

    try {
      if (appService?.isAndroidApp) {
        const selected = await selectAndroidDirectory();
        if (selected.path) {
          await handleSelectedNewDir(selected.path, { skipStoragePermission: true });
          return;
        }

        if (selected.error) {
          throw new Error(selected.error);
        }

        setMigrationStatus('idle');
        return;
      }

      const selectedDir = await appService?.selectDirectory?.(mode === 'connect' ? 'read' : 'write');
      if (selectedDir) {
        if (mode === 'connect') {
          const existingDataMatch = await findExistingDataMatch(selectedDir);
          if (!existingDataMatch) {
            throw new Error(
              _('No compatible Readest data was found in the selected folder.'),
            );
          }
          setNewDataDir(existingDataMatch.dataDir);
        } else {
          const newDataDir = await join(selectedDir, DATA_SUBDIR);
          await appService?.createDir(newDataDir, 'None', true);
          setNewDataDir(newDataDir);
        }
        setMigrationStatus('idle');
      } else {
        setMigrationStatus('idle');
      }
    } catch (error) {
      console.error('Error selecting directory:', error);
      setErrorMessage(String(error || _('Failed to select directory')));
      setMigrationStatus('error');
    }
  };

  const handleSelectedNewDir = async (
    dir: string,
    options?: { skipStoragePermission?: boolean },
  ) => {
    setErrorMessage('');

    if (!options?.skipStoragePermission && !dir.includes('Android/data')) {
      if (!(await requestStoragePermission())) return;
    }

    try {
      if (mode === 'connect') {
        const existingDataMatch = await findExistingDataMatch(dir);
        if (!existingDataMatch) {
          throw new Error(_('No compatible Readest data was found in the selected folder.'));
        }
        setNewDataDir(existingDataMatch.dataDir);
      } else {
        const newDataDir = await join(dir, DATA_SUBDIR);
        await appService?.createDir(newDataDir, 'None', true);
        setNewDataDir(newDataDir);
      }
      setMigrationStatus('idle');
    } catch (error) {
      console.error('Error selecting directory:', error);
      setErrorMessage(String(error || _('Failed to select directory')));
      setMigrationStatus('error');
    }
  };

  const handleConnectExistingData = async () => {
    if (!appService || !newDataDir) return;

    setMigrationStatus('migrating');
    setErrorMessage('');

    try {
      if (newDataDir === currentDataDir) {
        throw new Error(_('The selected data location is already in use.'));
      }

      const customRootDir = getDirPath(newDataDir);
      await appService.setCustomRootDir(customRootDir);

      const nextSettings = await appService.loadSettings();
      nextSettings.customRootDir = customRootDir;
      nextSettings.localBooksDir = await appService.resolveFilePath('', 'Books');
      setSettings(nextSettings);
      await saveSettings(envConfig, nextSettings);

      const library = await appService.loadLibraryBooks();
      setLibrary(library);

      setCurrentDataDir(newDataDir);
      setMigrationStatus('completed');
    } catch (error) {
      console.error('Error connecting existing data:', error);
      setErrorMessage(_('Failed to use the selected data: {{error}}', { error: error || 'Unknown error' }));
      setMigrationStatus('error');
    }
  };

  const handleStartMigration = async () => {
    if (!appService || !currentDataDir || !newDataDir || !filesToMigrate.length) return;

    setMigrationStatus('migrating');
    setErrorMessage('');
    setMigrationProgress({ current: 0, total: 0 });

    try {
      if (newDataDir === currentDataDir) {
        throw new Error(_('The new data directory must be different from the current one.'));
      }

      // Copy all files to new location
      for (let i = 0; i < filesToMigrate.length; i++) {
        const file = filesToMigrate[i]!;
        setMigrationProgress({
          current: i + 1,
          total: filesToMigrate.length,
          currentFile: file.path,
        });

        const srcPath = await join(currentDataDir, file.path);
        const destPath = await join(newDataDir, file.path);
        await appService.copyFile(srcPath, destPath, 'None');
      }

      // Verify all files copied
      const filesMigrated = await appService.readDirectory(newDataDir, 'None');
      for (const file of filesToMigrate) {
        if (!filesMigrated.find((f) => f.path === file.path && f.size === file.size)) {
          throw new Error(`File ${file.path} failed to copy.`);
        }
      }

      // Delete old data directory
      await appService.deleteDir(currentDataDir, 'None', true);

      // Update settings for new data directory
      const customRootDir = getDirPath(newDataDir);
      await appService.setCustomRootDir(customRootDir);
      settings.customRootDir = customRootDir;
      settings.localBooksDir = await appService.resolveFilePath('', 'Books');
      setSettings({ ...settings });
      await saveSettings(envConfig, settings);

      // Finalize migration
      setMigrationStatus('completed');
      setCurrentDataDir(newDataDir);
      setFilesToMigrate([]);
      setCurrentDirFileCount('');
      setCurrentDirFileSize(0);
      loadCurrentDataDir();
    } catch (error) {
      console.error('Error migrating data:', error);
      setErrorMessage(_('Migration failed: {{error}}', { error: error || 'Unknown error' }));
      setMigrationStatus('error');
    }
  };

  const handleClose = () => {
    if (migrationStatus === 'migrating') {
      return;
    }
    setIsOpen(false);
    setMode('migrate');
    setNewDataDir('');
    setMigrationStatus('idle');
    setErrorMessage('');
    setMigrationProgress({ current: 0, total: 0 });
  };

  const handleRestartApp = () => {
    relaunch();
  };

  const handleRevealDir = (dataDir: string) => {
    if (dataDir && appService?.isDesktopApp) {
      revealItemInDir(dataDir);
    }
  };

  const progressPercentage =
    migrationProgress.total > 0
      ? Math.round((migrationProgress.current / migrationProgress.total) * 100)
      : 0;

  const canStartMigration =
    newDataDir && newDataDir !== currentDataDir && migrationStatus === 'idle';
  const isMigrating = migrationStatus === 'migrating';
  const isConnectMode = mode === 'connect';

  const osPlatform = getOSPlatform();
  const fileRevealLabel =
    FILE_REVEAL_LABELS[osPlatform as FILE_REVEAL_PLATFORMS] || FILE_REVEAL_LABELS.default;

  const selectionTitle = isConnectMode ? _('Existing Readest Data') : _('New Data Location');
  const selectionButtonLabel = isConnectMode
    ? newDataDir
      ? _('Choose Different Existing Folder')
      : _('Choose Existing Folder')
    : newDataDir
      ? _('Choose Different Folder')
      : _('Choose New Folder');
  const selectionHint = isConnectMode
    ? _('Select the folder that already contains Readest data, or its parent folder.')
    : _('Choose a new folder for OpenReadest to move its data into.');
  const primaryActionLabel = isConnectMode ? _('Use Existing Data') : _('Start Migration');

  return (
    <Dialog
      id='migrate_data_dir_window'
      isOpen={isOpen}
      title={_('Change Data Location')}
      onClose={handleClose}
      boxClassName='sm:!w-[520px] sm:!max-w-screen-sm sm:h-auto'
    >
      {isOpen && (
        <div className='migrate-data-dir-content flex flex-col gap-6 px-6 py-4'>
          <div className='space-y-3'>
            <div className='bg-base-200 inline-flex rounded-xl p-1'>
              <button
                className={clsx(
                  'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  !isConnectMode ? 'bg-base-100 text-base-content shadow-sm' : 'text-base-content/70',
                )}
                onClick={() => {
                  setMode('migrate');
                  setNewDataDir('');
                  setErrorMessage('');
                  setMigrationStatus('idle');
                }}
                disabled={isMigrating}
              >
                {_('Move Current Data')}
              </button>
              <button
                className={clsx(
                  'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isConnectMode ? 'bg-base-100 text-base-content shadow-sm' : 'text-base-content/70',
                )}
                onClick={() => {
                  setMode('connect');
                  setNewDataDir('');
                  setErrorMessage('');
                  setMigrationStatus('idle');
                }}
                disabled={isMigrating}
              >
                {_('Use Existing Readest Data')}
              </button>
            </div>
            <p className='text-base-content/60 text-xs'>{selectionHint}</p>
          </div>

          {/* Current Data Directory */}
          <div className='space-y-2'>
            <h3 className='text-base-content text-sm font-semibold'>
              {_('Current Data Location')}
            </h3>
            <button
              title={_(fileRevealLabel)}
              className='bg-base-200 flex w-full items-center gap-2 rounded-lg p-3'
              onClick={() => handleRevealDir(currentDataDir)}
            >
              <RiFolderOpenLine className='text-base-content/70 h-4 w-4 flex-shrink-0' />
              <span className='text-base-content/80 break-all text-start font-mono text-sm'>
                {currentDataDir || _('Loading...')}
              </span>
            </button>
            {currentDirFileCount ? (
              <div className='flex space-x-4'>
                <p className='text-base-content/60 text-xs'>
                  {_('File count: {{size}}', { size: currentDirFileCount })}
                </p>
                <p className='text-base-content/60 text-xs'>
                  {_('Total size: {{size}}', { size: formatBytes(currentDirFileSize) })}
                </p>
              </div>
            ) : (
              <p className='text-base-content/60 text-xs'>{_('Calculating file info...')}</p>
            )}
          </div>

          {/* New Data Directory Selection */}
          <div className='space-y-3'>
            <h3 className='text-base-content text-sm font-semibold'>{selectionTitle}</h3>

            {newDataDir && (
              <button
                title={_(fileRevealLabel)}
                className='bg-primary/10 border-primary/20 flex w-full items-center gap-2 rounded-lg border p-3'
                onClick={() => handleRevealDir(newDataDir)}
              >
                <RiFolderOpenLine className='text-primary h-4 w-4 flex-shrink-0' />
                <span className='text-primary break-all text-start font-mono text-sm'>
                  {newDataDir}
                </span>
              </button>
            )}
            {appService?.isAndroidApp ? (
              <div className='space-y-3'>
                <button
                  className='btn btn-outline btn-sm w-full'
                  onClick={handleSelectNewDir}
                  disabled={isMigrating || migrationStatus === 'selecting'}
                >
                  {migrationStatus === 'selecting' && (
                    <RiLoader2Line className='h-4 w-4 animate-spin' />
                  )}
                  {_('使用系统文件管理器选择文件夹')}
                </button>
                <Dropdown
                  label={_('Quick Select Common Folders')}
                  className='dropdown-bottom flex w-full justify-center'
                  buttonClassName='btn btn-ghost btn-outline w-full'
                  toggleButton={<div>{_('常用目录快速选择')}</div>}
                >
                  <div
                    className={clsx(
                      'folder-menu dropdown-content dropdown-center no-triangle',
                      'border-base-300 !bg-base-200 z-20 mt-1 max-w-[90vw] shadow-2xl',
                    )}
                  >
                    {androidNewDirs.map((dir) => (
                      <MenuItem
                        key={dir.path}
                        toggled={newDataDir.split(`/${DATA_SUBDIR}`)[0] === dir.path}
                        transient
                        label={dir.label}
                        onClick={() => handleSelectedNewDir(dir.path)}
                      />
                    ))}
                  </div>
                </Dropdown>
              </div>
            ) : (
              <button
                className='btn btn-outline btn-sm w-full'
                onClick={handleSelectNewDir}
                disabled={isMigrating || migrationStatus === 'selecting'}
              >
                {migrationStatus === 'selecting' && (
                  <RiLoader2Line className='h-4 w-4 animate-spin' />
                )}
                {selectionButtonLabel}
              </button>
            )}
          </div>

          {/* Migration Progress */}
          {migrationStatus === 'migrating' && (
            <div className='space-y-3'>
              <div className='flex items-center gap-2'>
                <RiLoader2Line className='text-primary h-4 w-4 animate-spin' />
                <span className='text-base-content text-sm font-medium'>
                  {isConnectMode ? _('Connecting existing data...') : _('Migrating data...')}
                </span>
                {!isConnectMode && (
                  <span className='text-base-content/70 text-sm'>{progressPercentage}%</span>
                )}
              </div>

              {!isConnectMode && (
                <>
                  <div className='bg-base-200 h-2 w-full rounded-full'>
                    <div
                      className='bg-primary h-2 rounded-full transition-all duration-300'
                      style={{ width: `${progressPercentage}%` }}
                    />
                  </div>

                  {migrationProgress.currentFile && (
                    <p
                      className='text-base-content/60 overflow-hidden font-mono text-xs'
                      style={{
                        direction: 'rtl',
                        textAlign: 'left',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {_('Copying: {{file}}', { file: migrationProgress.currentFile })}
                    </p>
                  )}

                  <p className='text-base-content/60 text-xs'>
                    {_('{{current}} of {{total}} files', {
                      current: migrationProgress.current.toLocaleString(),
                      total: migrationProgress.total.toLocaleString(),
                    })}
                  </p>
                </>
              )}
            </div>
          )}

          {/* Success State */}
          {migrationStatus === 'completed' && (
            <div className='space-y-3'>
              <div className='text-success flex items-center gap-2'>
                <RiCheckboxCircleFill className='h-5 w-5' />
                <span className='font-medium'>
                  {isConnectMode
                    ? _('Existing data connected successfully!')
                    : _('Migration completed successfully!')}
                </span>
              </div>
              <div className='bg-success/10 border-success/20 rounded-lg border p-3'>
                <p className='text-success/80 text-sm'>
                  {isConnectMode
                    ? _(
                        'OpenReadest will use the selected Readest data after restart. Please restart the application to complete the switch.',
                      )
                    : _(
                        'Your data has been moved to the new location. Please restart the application to complete the process.',
                      )}
                </p>
              </div>
            </div>
          )}

          {/* Error State */}
          {migrationStatus === 'error' && errorMessage && (
            <div className='space-y-2'>
              <div className='text-error flex items-center gap-2'>
                <RiErrorWarningFill className='h-5 w-5' />
                <span className='font-medium'>{_('Migration failed')}</span>
              </div>
              <div className='bg-error/10 border-error/20 rounded-lg border p-3'>
                <p className='text-error/80 break-all text-sm'>{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Warning */}
          {canStartMigration && (
            <div className='bg-warning/10 border-warning/20 rounded-lg border p-3'>
              <div className='flex items-start gap-2'>
                <RiErrorWarningFill className='text-warning mt-0.5 h-4 w-4 flex-shrink-0' />
                <div className='space-y-1'>
                  <p className='text-base-content text-sm font-medium'>{_('Important Notice')}</p>
                  <p className='text-base-content/80 text-sm'>
                    {isConnectMode
                      ? _(
                          'This will switch OpenReadest to the selected Readest data location. Make sure you selected the library you want to continue using.',
                        )
                      : _(
                          'This will move all your app data to the new location. Make sure the destination has enough free space.',
                        )}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className='flex gap-3 pt-2'>
            {migrationStatus === 'completed' ? (
              <>
                <button className='btn btn-outline flex-1' onClick={handleClose}>
                  {_('Close')}
                </button>
                <button className='btn btn-primary flex-1' onClick={handleRestartApp}>
                  {_('Restart App')}
                </button>
              </>
            ) : (
              <>
                <button
                  className='btn btn-outline flex-1'
                  onClick={handleClose}
                  disabled={isMigrating}
                >
                  {_('Cancel')}
                </button>
                <button
                  className='btn btn-primary flex-1'
                  onClick={isConnectMode ? handleConnectExistingData : handleStartMigration}
                  disabled={!canStartMigration || migrationStatus !== 'idle'}
                >
                  {isMigrating && (
                    <RiLoader2Line className='h-4 w-4 animate-spin' />
                  )}
                  {primaryActionLabel}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
};
