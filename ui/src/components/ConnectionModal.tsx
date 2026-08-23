import React, { useState, useEffect, useMemo } from "react";
import {
  Server,
  Plus,
  Trash2,
  Zap,
  CheckCircle2,
  XCircle,
  X,
  HardDrive,
  RefreshCw,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  LogOut,
  Edit2,
  ArrowUp,
  ArrowDown,
  FolderPlus,
  AlertTriangle,
  Copy,
  Check,
  Lock,
} from "lucide-react";
import { ConnectionProfile, DBType } from "../types";
import { apiClient } from "../utils/apiClient";

interface ConnectionModalProps {
  isOpen: boolean;
  dismissible?: boolean;
  onClose: () => void;
  profiles: ConnectionProfile[];
  activeProfile?: ConnectionProfile | null;
  bootstrappingName?: string | null;
  autoUnlockProfileId?: string | null;
  hasRuntimePassword?: (id: string) => boolean;
  onUnlockProfile?: (id: string, password: string) => Promise<void>;
  onSaveProfile: (profile: Partial<ConnectionProfile>) => Promise<ConnectionProfile | void>;
  onSaveAllProfiles?: (profiles: ConnectionProfile[]) => Promise<void>;
  onDeleteProfile: (id: string) => Promise<void>;
  onConnect: (
    profile: ConnectionProfile,
    opts?: { ephemeral?: boolean }
  ) => Promise<{ success: boolean; error?: string }> | void;
  onDisconnect?: () => Promise<void> | void;
  onTestConnection: (profile: Partial<ConnectionProfile>) => Promise<{ success: boolean; message?: string; error?: string }>;
}

export const ConnectionModal: React.FC<ConnectionModalProps> = ({
  isOpen,
  dismissible = true,
  onClose,
  profiles,
  activeProfile,
  bootstrappingName,
  autoUnlockProfileId,
  hasRuntimePassword,
  onUnlockProfile,
  onSaveProfile,
  onSaveAllProfiles,
  onDeleteProfile,
  onConnect,
  onDisconnect,
  onTestConnection,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(activeProfile?.id || (profiles[0]?.id ?? null));
  const [form, setForm] = useState<Partial<ConnectionProfile>>({
    name: "Local Postgres",
    type: "postgres",
    group: "Default",
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "",
    database: "postgres",
    filePath: "",
    keepAlive: false,
    savePassword: true,
  });
  const [portText, setPortText] = useState<string>("5432");
  const [testResult, setTestResult] = useState<{ success: boolean; text: string } | null>(null);
  const [copiedErrorText, setCopiedErrorText] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [isCustomGroup, setIsCustomGroup] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // Group Management State
  const [groupOrder, setGroupOrder] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("dodb_group_order");
        if (saved) return JSON.parse(saved);
      } catch {
        // ignore
      }
    }
    return [];
  });

  const [groupContextMenu, setGroupContextMenu] = useState<{ x: number; y: number; groupName: string } | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<{ oldName: string; newName: string } | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);
  const [confirmDeleteProfile, setConfirmDeleteProfile] = useState<ConnectionProfile | null>(null);
  const [pendingConnect, setPendingConnect] = useState<Partial<ConnectionProfile> | null>(null);
  const [unlockRequest, setUnlockRequest] = useState<{
    profile: Partial<ConnectionProfile>;
    mode: "form" | "direct";
  } | null>(null);
  // Set when a supplied password was rejected, so the field stays flagged.
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const passwordInputRef = React.useRef<HTMLInputElement>(null);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleWindowClick = () => setGroupContextMenu(null);
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  // Escape key handler for submodals and menus (does not close the main connection modal)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pendingConnect) {
          setPendingConnect(null);
        } else if (confirmDeleteProfile) {
          setConfirmDeleteProfile(null);
        } else if (deletingGroup) {
          setDeletingGroup(null);
        } else if (renamingGroup) {
          setRenamingGroup(null);
        } else if (groupContextMenu) {
          setGroupContextMenu(null);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, pendingConnect, confirmDeleteProfile, deletingGroup, renamingGroup, groupContextMenu]);

  const availableGroups = useMemo(() => {
    return Array.from(
      new Set([
        "Default",
        "Production",
        "Staging",
        "Development",
        "Local",
        ...profiles.map((p) => p.group || "Default").filter(Boolean),
      ])
    );
  }, [profiles]);

  // Initialize selected profile once when modal opens
  useEffect(() => {
    if (isOpen) {
      if (activeProfile) {
        setSelectedId(activeProfile.id);
      } else if (!selectedId && profiles.length > 0) {
        setSelectedId(profiles[0].id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (selectedId && selectedId !== "__NEW__") {
      const p = profiles.find((item) => item.id === selectedId);
      if (p) {
        setForm({
          ...p,
          keepAlive: p.keepAlive === true,
          savePassword: p.savePassword !== false,
        });
        setPortText(p.port ? String(p.port) : (p.type === "postgres" ? "5432" : "3306"));
        const defaults = ["Default", "Production", "Staging", "Development", "Local"];
        const existing = profiles.map((pr) => pr.group).filter(Boolean);
        const allGroups = new Set([...defaults, ...existing]);
        if (p.group && !allGroups.has(p.group)) {
          setIsCustomGroup(true);
        } else {
          setIsCustomGroup(false);
        }
      }
    }
  }, [selectedId, profiles]);

  /// Flags the form's Password field instead of opening a second modal, so the
  /// password is typed where every other credential is.
  const requestUnlock = (profile: Partial<ConnectionProfile>, mode: "form" | "direct") => {
    setUnlockRequest({ profile, mode });
    setUnlockError(null);
  };

  // Move focus to the field the user is being asked to fill.
  useEffect(() => {
    if (!unlockRequest) return;
    const timer = window.setTimeout(() => passwordInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [unlockRequest]);

  // Drop a pending unlock once the user moves to a different profile.
  useEffect(() => {
    if (unlockRequest && unlockRequest.profile.id !== selectedId) {
      setUnlockRequest(null);
      setUnlockError(null);
    }
  }, [selectedId, unlockRequest]);

  // The field is red while the password it asked for is still missing, and
  // after a password the database rejected.
  const passwordFlagged = !!unlockError || (!!unlockRequest && !form.password);
  const passwordHint = unlockError
    ? unlockError
    : unlockRequest
      ? "Password required - kept in memory until dodb closes, never written to disk."
      : null;

  const autoUnlockAskedRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen || !autoUnlockProfileId) return;
    if (autoUnlockAskedRef.current === autoUnlockProfileId) return;
    const target = profiles.find((p) => p.id === autoUnlockProfileId);
    if (!target) return;
    autoUnlockAskedRef.current = autoUnlockProfileId;
    setSelectedId(target.id);
    requestUnlock(target, "direct");
  }, [isOpen, autoUnlockProfileId, profiles]);

  const handleTypeChange = (type: DBType) => {
    if (type === "sqlite") {
      setForm((prev) => ({
        ...prev,
        type,
        name: prev.name && prev.name !== "Local Postgres" && prev.name !== "Local MariaDB" ? prev.name : "Local SQLite",
        filePath: prev.filePath || "./data/database.sqlite",
        database: prev.filePath || "./data/database.sqlite",
      }));
    } else {
      const defaultPort = type === "postgres" ? 5432 : 3306;
      setPortText(String(defaultPort));
      setForm((prev) => ({
        ...prev,
        type,
        port: defaultPort,
        user: type === "postgres" ? "postgres" : "root",
        database: type === "postgres" ? "postgres" : "mysql",
      }));
    }
  };

  const getCleanForm = (): Partial<ConnectionProfile> => {
    const finalPort = portText ? parseInt(portText, 10) : (form.type === "postgres" ? 5432 : 3306);
    const data: Partial<ConnectionProfile> = {
      ...form,
      port: isNaN(finalPort) ? (form.type === "postgres" ? 5432 : 3306) : finalPort,
      group: form.group ? form.group.trim() : "Default",
      keepAlive: form.keepAlive === true,
      // SQLite has no password to withhold, so the switch never applies to it.
      savePassword: form.type === "sqlite" ? true : form.savePassword !== false,
    };
    if (selectedId === "__NEW__") {
      delete data.id;
    }
    return data;
  };

  const handleBrowseSqliteFile = async () => {
    try {
      const selectedPath = await apiClient.selectFile();
      if (selectedPath) {
        setForm((prev) => ({
          ...prev,
          filePath: selectedPath,
          database: selectedPath,
        }));
      }
    } catch (err) {
      console.error("Browse file error", err);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const cleanData = getCleanForm();
      const res = await onTestConnection(cleanData);
      if (res.success) {
        setTestResult({ success: true, text: "Connection test successful" });
      } else {
        setTestResult({ success: false, text: `Connection test failed: ${res.error || "Unknown error"}` });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ success: false, text: `Error: ${msg}` });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const cleanData = getCleanForm();
      const saved = (await onSaveProfile(cleanData)) as ConnectionProfile | undefined;
      if (saved && saved.id) {
        setSelectedId(saved.id);
      }
      setTestResult({ success: true, text: "Profile saved successfully" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ success: false, text: `Save failed: ${msg}` });
    } finally {
      setSaving(false);
    }
  };

  // True when the form differs from the saved profile it was loaded from.
  // Connecting would otherwise use the stored credentials while showing the
  // edited ones, because the backend looks the profile up by id.
  // `data` defaults to the live form, but the unlock path passes the values it
  // is about to connect with so the password it just put in memory - and has
  // already dropped from the form - does not read as an edit.
  const isFormDirty = (data?: Partial<ConnectionProfile>): boolean => {
    if (selectedId === "__NEW__") return false;
    const saved = profiles.find((p) => p.id === selectedId);
    if (!saved) return false;
    const current = data ?? getCleanForm();
    const fields: (keyof ConnectionProfile)[] = [
      "name", "type", "host", "port", "user", "password", "database", "filePath", "group",
      "keepAlive", "savePassword",
    ];
    return fields.some((f) => {
      const a = current[f] ?? "";
      const b = saved[f] ?? "";
      return String(a) !== String(b);
    });
  };

  /// Tests the connection, hands it to the app, and only closes the modal when
  /// the app could actually use it.
  const connectWith = async (data: Partial<ConnectionProfile>, ephemeral: boolean) => {
    setConnecting(true);
    setTestResult(null);
    try {
      const res = await onTestConnection(data);
      if (!res.success) {
        setTestResult({ success: false, text: `Connection failed: ${res.error || "Could not reach database"}` });
        return;
      }
      const outcome = await onConnect(data as ConnectionProfile, { ephemeral });
      if (outcome && !outcome.success) {
        setTestResult({ success: false, text: outcome.error || "Connected, but the database list could not be loaded." });
        return;
      }
      setTestResult({
        success: true,
        text: ephemeral ? "Connected (this session only - not saved)" : "Connected successfully!",
      });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ success: false, text: `Connection error: ${msg}` });
    } finally {
      setConnecting(false);
    }
  };

  const needsPassword = (data: Partial<ConnectionProfile>): boolean => {
    if (data.type === "sqlite") return false;
    if (data.savePassword !== false) return false;
    if (data.password) return false;
    return !(data.id && hasRuntimePassword?.(data.id));
  };

  const connectFromForm = async (cleanData: Partial<ConnectionProfile>) => {
    if (isFormDirty(cleanData)) {
      setPendingConnect(cleanData);
      return;
    }
    await connectWith(cleanData, false);
  };

  const handleConnect = async () => {
    const cleanData = getCleanForm();
    if (cleanData.type !== "sqlite" && !cleanData.host) return;
    if (cleanData.type === "sqlite" && !cleanData.filePath && !cleanData.database) return;

    // For brand-new connections: enforce save to disk and then connect.
    if (selectedId === "__NEW__") {
      setConnecting(true);
      setTestResult(null);
      try {
        const testRes = await onTestConnection(cleanData);
        if (!testRes.success) {
          setTestResult({ success: false, text: `Connection failed: ${testRes.error || "Could not reach database"}` });
          return;
        }
        setSaving(true);
        const saved = (await onSaveProfile(cleanData)) as ConnectionProfile | undefined;
        setSaving(false);
        if (!saved || !saved.id) {
          setTestResult({ success: false, text: "Failed to save profile before connecting." });
          return;
        }
        setSelectedId(saved.id);
        const outcome = await onConnect(saved, { ephemeral: false });
        if (outcome && !outcome.success) {
          setTestResult({ success: false, text: outcome.error || "Connected, but the database list could not be loaded." });
          return;
        }
        setTestResult({
          success: true,
          text: "Profile saved & connected successfully!",
        });
        onClose();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setTestResult({ success: false, text: `Connection error: ${msg}` });
      } finally {
        setConnecting(false);
        setSaving(false);
      }
      return;
    }

    if (unlockRequest && cleanData.password) {
      await submitUnlock(cleanData.password);
      return;
    }

    if (needsPassword(cleanData)) {
      setTestResult(null);
      requestUnlock(cleanData, "form");
      return;
    }

    await connectFromForm(cleanData);
  };

  /// Connects a profile exactly as stored, skipping the form. Split out so the
  /// password prompt can resume it.
  const connectStoredProfile = async (profile: ConnectionProfile) => {
    setConnecting(true);
    setTestResult(null);
    try {
      const res = await onTestConnection(profile);
      if (res.success) {
        const outcome = await onConnect(profile);
        if (outcome && !outcome.success) {
          setTestResult({ success: false, text: outcome.error || "Connected, but the database list could not be loaded." });
          return;
        }
        onClose();
      } else {
        setTestResult({ success: false, text: `Connection failed: ${res.error || "Could not reach database"}` });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ success: false, text: `Connection error: ${msg}` });
    } finally {
      setConnecting(false);
    }
  };

  const handleConnectDirectly = async (profile: ConnectionProfile) => {
    setSelectedId(profile.id);
    if (needsPassword(profile)) {
      setTestResult(null);
      requestUnlock(profile, "direct");
      return;
    }
    await connectStoredProfile(profile);
  };

  /// Hands the typed password to the app - which keeps it in memory only - and
  /// resumes the connect that asked for it.
  const submitUnlock = async (value: string) => {
    if (!unlockRequest) return;
    const { profile, mode } = unlockRequest;
    if (!profile.id || !onUnlockProfile) {
      setUnlockError("This connection has no id yet - save it first.");
      return;
    }
    setUnlocking(true);
    try {
      await onUnlockProfile(profile.id, value);
      setUnlockRequest(null);
      setUnlockError(null);
      // The password lives in memory only, so it must not linger in the form
      // and make it look edited.
      setForm((prev) => ({ ...prev, password: "" }));
      if (mode === "direct") {
        await connectStoredProfile(profile as ConnectionProfile);
      } else {
        await connectFromForm({ ...profile, password: "" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setUnlockError(`Could not use that password: ${msg}`);
    } finally {
      setUnlocking(false);
    }
  };

  const handleCreateNew = () => {
    setSelectedId("__NEW__");
    setPortText("5432");
    setForm({
      name: "New Connection",
      type: "postgres",
      group: "Default",
      host: "localhost",
      port: 5432,
      user: "postgres",
      password: "",
      database: "postgres",
      filePath: "",
      keepAlive: false,
      savePassword: true,
    });
    setIsCustomGroup(false);
    setTestResult(null);
  };

  const handleCreateNewInGroup = (groupName: string) => {
    setSelectedId("__NEW__");
    setPortText("5432");
    setForm({
      name: `New ${groupName} Connection`,
      type: "postgres",
      group: groupName,
      host: "localhost",
      port: 5432,
      user: "postgres",
      password: "",
      database: "postgres",
      filePath: "",
      keepAlive: false,
      savePassword: true,
    });
    setIsCustomGroup(false);
    setTestResult(null);
  };

  // Group Management Handlers
  const handleRenameGroup = async (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) {
      setRenamingGroup(null);
      return;
    }
    const updated = profiles.map((p) => {
      const currentG = p.group && p.group.trim() !== "" ? p.group : "Default";
      if (currentG === oldName) {
        return { ...p, group: trimmed };
      }
      return p;
    });

    if (onSaveAllProfiles) {
      await onSaveAllProfiles(updated);
    } else {
      for (const p of updated) {
        if (p.group === trimmed) {
          await onSaveProfile(p);
        }
      }
    }

    const newOrder = groupOrder.map((g) => (g === oldName ? trimmed : g));
    if (!newOrder.includes(trimmed)) newOrder.push(trimmed);
    setGroupOrder(newOrder);
    try {
      localStorage.setItem("dodb_group_order", JSON.stringify(newOrder));
    } catch { }

    if ((form.group || "Default") === oldName) {
      setForm((prev) => ({ ...prev, group: trimmed }));
    }
    setRenamingGroup(null);
  };

  const handleDeleteGroupConfirm = async (groupName: string, mode: "delete_all" | "move_default") => {
    if (mode === "delete_all") {
      const targets = profiles.filter((p) => (p.group || "Default") === groupName);
      for (const p of targets) {
        await onDeleteProfile(p.id);
      }
    } else {
      const updated = profiles.map((p) => {
        if ((p.group || "Default") === groupName) {
          return { ...p, group: "Default" };
        }
        return p;
      });
      if (onSaveAllProfiles) {
        await onSaveAllProfiles(updated);
      } else {
        for (const p of updated) {
          if (p.group === "Default") {
            await onSaveProfile(p);
          }
        }
      }
    }

    const newOrder = groupOrder.filter((g) => g !== groupName);
    setGroupOrder(newOrder);
    try {
      localStorage.setItem("dodb_group_order", JSON.stringify(newOrder));
    } catch { }
    setDeletingGroup(null);
  };

  const handleMoveGroup = (groupName: string, direction: -1 | 1) => {
    const currentGroups = sortedGroupNames;
    const idx = currentGroups.indexOf(groupName);
    if (idx === -1) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= currentGroups.length) return;

    const newOrder = [...currentGroups];
    const [removed] = newOrder.splice(idx, 1);
    newOrder.splice(targetIdx, 0, removed);
    setGroupOrder(newOrder);
    try {
      localStorage.setItem("dodb_group_order", JSON.stringify(newOrder));
    } catch { }
  };

  // Group profiles
  const groupedProfiles: Record<string, ConnectionProfile[]> = {};
  profiles.forEach((p) => {
    const gName = p.group && p.group.trim() !== "" ? p.group : "Default";
    if (!groupedProfiles[gName]) {
      groupedProfiles[gName] = [];
    }
    groupedProfiles[gName].push(p);
  });

  // Sort groups based on groupOrder
  const allGroupKeys = Object.keys(groupedProfiles);
  const sortedGroupNames = useMemo(() => {
    return [...allGroupKeys].sort((a, b) => {
      const idxA = groupOrder.indexOf(a);
      const idxB = groupOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [allGroupKeys, groupOrder]);

  const toggleGroupCollapse = (gName: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [gName]: !prev[gName] }));
  };

  const isCurrentActive = Boolean(activeProfile && selectedId === activeProfile.id);
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={dismissible ? onClose : undefined}>
      <div className="modal-window" onClick={(e) => e.stopPropagation()}>
        {/* macOS Style Window Top Bar */}
        <div className="window-header">
          <div className="window-title-left">
            <div className="app-icon-badge">
              <Server size={15} />
            </div>
            <div className="title-text-group">
              <span className="window-main-title">Database Connections</span>
              <span className={`window-sub-title${dismissible ? "" : " required"}`}>
                {bootstrappingName
                  ? `Reconnecting to ${bootstrappingName}...`
                  : dismissible
                    ? "Manage connection profiles and environments"
                    : "Connect to a database to continue"}
              </span>
            </div>
            {activeProfile && (
              <span className="active-conn-pill">
                <span className="pulse-green-dot" />
                Active: {activeProfile.name}
              </span>
            )}
          </div>
          {dismissible && (
            <button className="window-close-btn" onClick={onClose} title="Close">
              <X size={15} />
            </button>
          )}
        </div>

        <div className="window-body">
          {/* Left Master Sidebar */}
          <aside className="conn-sidebar">
            <div className="sidebar-top-action">
              <button className="btn btn-primary new-conn-btn" onClick={handleCreateNew}>
                <Plus size={14} />
                <span>New Connection</span>
              </button>
            </div>

            <div className="sidebar-scrollable-list">
              {sortedGroupNames.length === 0 ? (
                <div className="empty-profiles-notice">
                  <FolderOpen size={24} className="empty-icon" />
                  <span>No connection profiles</span>
                </div>
              ) : (
                sortedGroupNames.map((groupName) => {
                  const groupItems = groupedProfiles[groupName] || [];
                  const isCollapsed = collapsedGroups[groupName];
                  return (
                    <div key={groupName} className="conn-group-section">
                      <div
                        className="conn-group-header"
                        onClick={() => toggleGroupCollapse(groupName)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setGroupContextMenu({
                            x: Math.min(e.clientX, window.innerWidth - 220),
                            y: Math.min(e.clientY, window.innerHeight - 240),
                            groupName,
                          });
                        }}
                        title="Right-click for group options"
                      >
                        <div className="group-header-left">
                          <span className="group-arrow-icon">
                            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                          </span>
                          <Folder size={13} className="group-folder-icon" />
                          <span className="group-name-text">{groupName}</span>
                          <span className="group-count-badge">{groupItems.length}</span>
                        </div>

                        <div className="group-quick-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="group-tool-btn"
                            title="Move Group Up"
                            onClick={() => handleMoveGroup(groupName, -1)}
                          >
                            <ArrowUp size={11} />
                          </button>
                          <button
                            className="group-tool-btn"
                            title="Move Group Down"
                            onClick={() => handleMoveGroup(groupName, 1)}
                          >
                            <ArrowDown size={11} />
                          </button>
                          <button
                            className="group-tool-btn"
                            title="Add Connection in this Group"
                            onClick={() => handleCreateNewInGroup(groupName)}
                          >
                            <FolderPlus size={11} />
                          </button>
                          <button
                            className="group-tool-btn"
                            title="Rename Group"
                            onClick={() => setRenamingGroup({ oldName: groupName, newName: groupName })}
                          >
                            <Edit2 size={11} />
                          </button>
                          <button
                            className="group-tool-btn danger-tool"
                            title="Delete Group"
                            onClick={() => setDeletingGroup(groupName)}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>

                      {!isCollapsed && (
                        <div className="conn-items-list">
                          {selectedId === "__NEW__" && (form.group || "Default") === groupName && (
                            <div className="conn-card-item active is-draft-card">
                              <div className="engine-avatar new-avatar">
                                <Plus size={13} />
                              </div>
                              <div className="conn-card-info">
                                <div className="card-top-line">
                                  <span className="card-title">{form.name || "New Connection"}</span>
                                  <span className="draft-pill">Draft</span>
                                </div>
                                <span className="card-subtitle">
                                  {form.type?.toUpperCase()} • {form.type === "sqlite" ? form.filePath || "database.sqlite" : `${form.host || "localhost"}:${portText}`}
                                </span>
                              </div>
                            </div>
                          )}

                          {groupItems.map((p) => {
                            const isConnected = activeProfile?.id === p.id;
                            const isSelected = selectedId === p.id;
                            const typeClass = p.type || "postgres";

                            return (
                              <div
                                key={p.id}
                                className={`conn-card-item ${isSelected ? "active" : ""} ${isConnected ? "is-connected" : ""}`}
                                onClick={() => setSelectedId(p.id)}
                                onDoubleClick={() => handleConnectDirectly(p)}
                                title="Click to edit, Double-click to Connect"
                              >
                                <div className={`engine-avatar ${typeClass}-avatar`}>
                                  <HardDrive size={13} />
                                  {isConnected && <span className="avatar-online-dot" />}
                                </div>

                                <div className="conn-card-info">
                                  <div className="card-top-line">
                                    <span className="card-title">{p.name}</span>
                                    {isConnected && <span className="connected-tag">Online</span>}
                                  </div>
                                  <span className="card-subtitle">
                                    <span className={`engine-type-tag ${typeClass}`}>{p.type.toUpperCase()}</span>
                                    <span className="host-text">
                                      {p.type === "sqlite" ? p.filePath || p.database : `${p.host}:${p.port}`}
                                    </span>
                                  </span>
                                </div>

                                <button
                                  className="quick-zap-btn"
                                  title="Quick Connect"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleConnectDirectly(p);
                                  }}
                                >
                                  <Zap size={11} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          {/* Right Detail / Form Panel */}
          <main className="conn-editor-panel">
            <div className="editor-content-area">
              {isCurrentActive && (
                <div className="active-profile-banner">
                  <div className="banner-left">
                    <span className="pulse-green-dot" />
                    <span className="banner-msg">Currently connected to <strong>{form.name}</strong></span>
                  </div>
                  {onDisconnect && (
                    <button
                      className="btn-disconnect-chip"
                      onClick={async () => {
                        setDisconnecting(true);
                        try {
                          await onDisconnect();
                        } finally {
                          setDisconnecting(false);
                        }
                      }}
                      disabled={disconnecting}
                    >
                      <LogOut size={11} />
                      <span>{disconnecting ? "Disconnecting..." : "Disconnect"}</span>
                    </button>
                  )}
                </div>
              )}



              {/* Database Engine Type Segmented Picker */}
              <div className="form-section-card">
                <div className="section-label">Database Type</div>
                <div className="engine-segmented-control">
                  <button
                    type="button"
                    className={`engine-seg-btn postgres ${form.type === "postgres" ? "active" : ""}`}
                    onClick={() => handleTypeChange("postgres")}
                  >
                    <Server size={14} className="seg-icon" />
                    <span className="seg-label">PostgreSQL</span>
                  </button>
                  <button
                    type="button"
                    className={`engine-seg-btn mariadb ${form.type === "mariadb" ? "active" : ""}`}
                    onClick={() => handleTypeChange("mariadb")}
                  >
                    <Server size={14} className="seg-icon" />
                    <span className="seg-label">MySQL / MariaDB</span>
                  </button>
                  <button
                    type="button"
                    className={`engine-seg-btn sqlite ${form.type === "sqlite" ? "active" : ""}`}
                    onClick={() => handleTypeChange("sqlite")}
                  >
                    <HardDrive size={14} className="seg-icon" />
                    <span className="seg-label">SQLite</span>
                  </button>
                </div>
              </div>

              {/* General Connection Settings */}
              <div className="form-section-card">
                {testResult && (
                  <div className={`status-feedback-box ${testResult.success ? "success" : "error"}`}>
                    <div className="feedback-content-left">
                      {testResult.success ? <CheckCircle2 size={14} className="feedback-icon" /> : <XCircle size={14} className="feedback-icon" />}
                      <span className="feedback-text">{testResult.text}</span>
                    </div>
                    {!testResult.success && (
                      <button
                        type="button"
                        className="btn-feedback-copy"
                        onClick={() => {
                          navigator.clipboard.writeText(testResult.text);
                          setCopiedErrorText(true);
                          setTimeout(() => setCopiedErrorText(false), 2000);
                        }}
                        title="Copy error message"
                      >
                        {copiedErrorText ? <Check size={11} /> : <Copy size={11} />}
                        <span>{copiedErrorText ? "Copied" : "Copy"}</span>
                      </button>
                    )}
                  </div>
                )}
                <div className="section-label">Connection Details</div>

                <div className="field-grid-2">
                  <div className="field-group flex-2">
                    <label className="field-label">Profile Name</label>
                    <input
                      className="input form-input"
                      placeholder="e.g. Production Postgres"
                      value={form.name || ""}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>

                  <div className="field-group flex-1">
                    <label className="field-label">Group / Folder</label>
                    {isCustomGroup ? (
                      <div className="custom-group-input-wrap">
                        <input
                          className="input form-input"
                          placeholder="Group name"
                          value={form.group || ""}
                          onChange={(e) => setForm({ ...form, group: e.target.value })}
                          autoFocus
                        />
                        <button
                          className="btn-clear-group"
                          onClick={() => {
                            setIsCustomGroup(false);
                            setForm({ ...form, group: "Default" });
                          }}
                          title="Select from existing"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <select
                        className="select form-select"
                        value={form.group || "Default"}
                        onChange={(e) => {
                          if (e.target.value === "__NEW__") {
                            setIsCustomGroup(true);
                            setForm({ ...form, group: "" });
                          } else {
                            setForm({ ...form, group: e.target.value });
                          }
                        }}
                      >
                        {availableGroups.map((grp) => (
                          <option key={grp} value={grp}>
                            {grp}
                          </option>
                        ))}
                        <option value="__NEW__">+ New Group...</option>
                      </select>
                    )}
                  </div>
                </div>

                {form.type === "sqlite" ? (
                  <div className="field-group mt-12">
                    <label className="field-label">SQLite Database File Path</label>
                    <div className="file-input-group">
                      <input
                        className="input form-input font-mono"
                        placeholder="/path/to/database.sqlite or ./data/db.sqlite"
                        value={form.filePath || ""}
                        onChange={(e) => setForm({ ...form, filePath: e.target.value })}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary browse-file-btn"
                        onClick={handleBrowseSqliteFile}
                        title="Browse file on disk"
                      >
                        <FolderOpen size={13} />
                        <span>Browse...</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="field-grid-2 mt-12">
                      <div className="field-group flex-2">
                        <label className="field-label">Host</label>
                        <input
                          className="input form-input font-mono"
                          placeholder="localhost or 127.0.0.1"
                          value={form.host || ""}
                          onChange={(e) => setForm({ ...form, host: e.target.value })}
                        />
                      </div>
                      <div className="field-group flex-1">
                        <label className="field-label">Port</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="input form-input font-mono"
                          placeholder={form.type === "postgres" ? "5432" : "3306"}
                          value={portText}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === "" || /^\d+$/.test(val)) {
                              setPortText(val);
                            }
                          }}
                        />
                      </div>
                    </div>

                    <div className="field-grid-2 mt-12">
                      <div className="field-group">
                        <label className="field-label">User</label>
                        <input
                          className="input form-input"
                          placeholder={form.type === "postgres" ? "postgres" : "root"}
                          value={form.user || ""}
                          onChange={(e) => setForm({ ...form, user: e.target.value })}
                        />
                      </div>
                      <div className="field-group">
                        <label className="field-label">Password</label>
                        <input
                          ref={passwordInputRef}
                          type="password"
                          className={`input form-input${passwordFlagged ? " input-invalid" : ""}`}
                          placeholder="••••••••"
                          value={form.password || ""}
                          onChange={(e) => {
                            setForm({ ...form, password: e.target.value });
                            if (unlockError) setUnlockError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && unlockRequest) {
                              e.preventDefault();
                              handleConnect();
                            }
                          }}
                        />
                        {passwordHint && (
                          <span className="field-error-hint">
                            <Lock size={10} />
                            <span>{passwordHint}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="field-group mt-12">
                      <label className="field-label">Database Name</label>
                      <input
                        className="input form-input font-mono"
                        placeholder={form.type === "postgres" ? "postgres" : "mysql"}
                        value={form.database || ""}
                        onChange={(e) => setForm({ ...form, database: e.target.value })}
                      />
                    </div>

                    <label className="field-switch mt-12">
                      <input
                        type="checkbox"
                        checked={form.savePassword !== false}
                        onChange={(e) => setForm({ ...form, savePassword: e.target.checked })}
                      />
                      <span className="field-switch-text">
                        <span className="field-switch-title">Save password</span>
                        <span className="field-switch-hint">
                          Off: the password is never written to disk - dodb asks for it once each
                          time the app starts.
                        </span>
                      </span>
                    </label>
                  </>
                )}

                <label className="field-switch mt-12">
                  <input
                    type="checkbox"
                    checked={form.keepAlive === true}
                    onChange={(e) => setForm({ ...form, keepAlive: e.target.checked })}
                  />
                  <span className="field-switch-text">
                    <span className="field-switch-title">Keep connection alive</span>
                    <span className="field-switch-hint">
                      Holds the connection open, reconnects on its own when it drops, and connects
                      this profile when dodb starts.
                    </span>
                  </span>
                </label>
              </div>
            </div>

            {/* Bottom Footer Actions */}
            <footer className="editor-footer-bar">
              <div className="footer-left">
                {selectedId && selectedId !== "__NEW__" && (
                  <button
                    className="btn-del-profile"
                    onClick={() => {
                      const currentProfile = profiles.find((p) => p.id === selectedId);
                      if (currentProfile) {
                        setConfirmDeleteProfile(currentProfile);
                      }
                    }}
                    disabled={connecting || disconnecting}
                    title="Delete this Profile"
                  >
                    <Trash2 size={13} />
                    <span>Delete</span>
                  </button>
                )}
              </div>

              <div className="footer-right">
                <button
                  className="btn btn-secondary test-btn"
                  onClick={handleTest}
                  disabled={testing || connecting || disconnecting}
                >
                  {testing ? <RefreshCw size={13} className="spin" /> : <Zap size={13} />}
                  <span>{testing ? "Testing..." : "Test Connection"}</span>
                </button>

                <button
                  className="btn btn-secondary save-btn"
                  onClick={handleSave}
                  disabled={saving || connecting || disconnecting}
                >
                  {saving ? <RefreshCw size={13} className="spin" /> : null}
                  <span>{saving ? "Saving..." : "Save"}</span>
                </button>

                <button
                  className="btn btn-primary connect-main-btn"
                  onClick={handleConnect}
                  disabled={connecting || unlocking || testing || saving || disconnecting}
                >
                  {connecting || unlocking ? <RefreshCw size={13} className="spin" /> : <Zap size={13} />}
                  <span>
                    {connecting || unlocking
                      ? "Connecting..."
                      : selectedId === "__NEW__"
                        ? "Save & Connect"
                        : unlockRequest
                          ? "Unlock & Connect"
                          : isCurrentActive
                            ? "Reconnect"
                            : "Connect"}
                  </span>
                </button>
              </div>
            </footer>
          </main>
        </div>
      </div>

      {/* Group Context Menu */}
      {groupContextMenu && (
        <div
          className="group-context-menu"
          style={{
            position: "fixed",
            left: groupContextMenu.x,
            top: groupContextMenu.y,
            zIndex: 999999,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-header">
            <Folder size={12} className="folder-icon" />
            <span className="context-group-title">{groupContextMenu.groupName}</span>
          </div>
          <div className="context-menu-divider" />
          <button
            className="context-menu-item"
            onClick={() => {
              const g = groupContextMenu.groupName;
              setGroupContextMenu(null);
              setRenamingGroup({ oldName: g, newName: g });
            }}
          >
            <Edit2 size={12} />
            <span>Rename Group</span>
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              const g = groupContextMenu.groupName;
              setGroupContextMenu(null);
              handleCreateNewInGroup(g);
            }}
          >
            <FolderPlus size={12} />
            <span>Add Connection to Group</span>
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              const g = groupContextMenu.groupName;
              setGroupContextMenu(null);
              handleMoveGroup(g, -1);
            }}
          >
            <ArrowUp size={12} />
            <span>Move Up</span>
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              const g = groupContextMenu.groupName;
              setGroupContextMenu(null);
              handleMoveGroup(g, 1);
            }}
          >
            <ArrowDown size={12} />
            <span>Move Down</span>
          </button>
          <div className="context-menu-divider" />
          <button
            className="context-menu-item danger"
            onClick={() => {
              const g = groupContextMenu.groupName;
              setGroupContextMenu(null);
              setDeletingGroup(g);
            }}
          >
            <Trash2 size={12} />
            <span>Delete Group...</span>
          </button>
        </div>
      )}

      {/* Rename Group Dialog Modal */}
      {renamingGroup && (
        <div className="submodal-overlay" onClick={() => setRenamingGroup(null)}>
          <div className="submodal-card" onClick={(e) => e.stopPropagation()}>
            <div className="submodal-header">
              <Edit2 size={14} />
              <span>Rename Group</span>
            </div>
            <div className="submodal-body">
              <label className="field-label">New Group Name</label>
              <input
                className="input form-input"
                value={renamingGroup.newName}
                onChange={(e) => setRenamingGroup({ ...renamingGroup, newName: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameGroup(renamingGroup.oldName, renamingGroup.newName);
                  if (e.key === "Escape") setRenamingGroup(null);
                }}
                autoFocus
              />
            </div>
            <div className="submodal-actions">
              <button className="btn btn-secondary" onClick={() => setRenamingGroup(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => handleRenameGroup(renamingGroup.oldName, renamingGroup.newName)}
                disabled={!renamingGroup.newName.trim()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Group Dialog Modal */}
      {deletingGroup && (
        <div className="submodal-overlay" onClick={() => setDeletingGroup(null)}>
          <div className="submodal-card" onClick={(e) => e.stopPropagation()}>
            <div className="submodal-header danger-header">
              <AlertTriangle size={14} className="danger-icon" />
              <span>Delete Group</span>
            </div>
            <div className="submodal-body">
              <p className="submodal-desc">
                Delete group <strong>&quot;{deletingGroup}&quot;</strong>?
              </p>
            </div>
            <div className="submodal-column-actions">
              <button
                className="btn btn-secondary submodal-btn-choice"
                onClick={() => handleDeleteGroupConfirm(deletingGroup, "move_default")}
              >
                <Folder size={13} />
                <span>Move connections to Default & Delete Group</span>
              </button>
              <button
                className="btn btn-danger submodal-btn-choice"
                onClick={() => handleDeleteGroupConfirm(deletingGroup, "delete_all")}
              >
                <Trash2 size={13} />
                <span>Delete Group & All Connections</span>
              </button>
              <button className="btn btn-secondary cancel-choice-btn" onClick={() => setDeletingGroup(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved-edits Connect Choice */}
      {pendingConnect && (
        <div className="submodal-overlay" onClick={() => setPendingConnect(null)}>
          <div className="submodal-card" onClick={(e) => e.stopPropagation()}>
            <div className="submodal-header">
              <AlertTriangle size={14} />
              <span>Unsaved changes</span>
            </div>
            <div className="submodal-body">
              <p className="submodal-desc">
                This profile has edits that are not saved. Connecting with the saved values would
                ignore them - which values should be used?
              </p>
            </div>
            <div className="submodal-actions">
              <button className="btn btn-secondary" onClick={() => setPendingConnect(null)}>
                Cancel
              </button>
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  const data = pendingConnect;
                  setPendingConnect(null);
                  await connectWith({ ...data, id: undefined }, true);
                }}
              >
                <Zap size={12} />
                <span>Connect without saving</span>
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const data = pendingConnect;
                  setPendingConnect(null);
                  setSaving(true);
                  try {
                    const saved = (await onSaveProfile(data as Partial<ConnectionProfile>)) as ConnectionProfile | undefined;
                    if (saved && saved.id) setSelectedId(saved.id);
                    await connectWith(saved && saved.id ? saved : (data as Partial<ConnectionProfile>), false);
                  } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    setTestResult({ success: false, text: `Save failed: ${msg}` });
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <CheckCircle2 size={12} />
                <span>Save &amp; Connect</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Profile Confirmation Modal */}
      {confirmDeleteProfile && (
        <div className="submodal-overlay" onClick={() => setConfirmDeleteProfile(null)}>
          <div className="submodal-card" onClick={(e) => e.stopPropagation()}>
            <div className="submodal-header danger-header">
              <AlertTriangle size={14} className="danger-icon" />
              <span>Delete Profile</span>
            </div>
            <div className="submodal-body">
              <p className="submodal-desc">
                Delete profile <strong>&quot;{confirmDeleteProfile.name}&quot;</strong>?
              </p>
            </div>
            <div className="submodal-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmDeleteProfile(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  const targetId = confirmDeleteProfile.id;
                  setConfirmDeleteProfile(null);
                  await onDeleteProfile(targetId);
                  handleCreateNew();
                }}
              >
                <Trash2 size={12} />
                <span>Confirm</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.72);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 20px;
        }

        .modal-window {
          width: 860px;
          height: 600px;
          max-width: 95vw;
          max-height: 90vh;
          background: var(--bg-app);
          border: 1px solid var(--border-medium);
          border-radius: 12px;
          box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.2);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: modalAppear 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes modalAppear {
          from { opacity: 0; transform: scale(0.97) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }

        /* Top Header */
        .window-header {
          padding: 12px 18px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
          user-select: none;
        }
        .window-title-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .app-icon-badge {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .title-text-group {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .window-main-title {
          font-size: 13.5px;
          font-weight: 700;
          color: var(--text-main);
          letter-spacing: -0.2px;
        }
        .window-sub-title {
          font-size: 10.5px;
        }
        .window-sub-title.required {
          color: gray;
          font-weight: 600;
        }
        .active-conn-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(16, 185, 129, 0.12);
          border: 1px solid rgba(16, 185, 129, 0.35);
          color: var(--accent-green);
          font-size: 10px;
          padding: 2.5px 8px;
          border-radius: 12px;
          font-weight: 600;
          margin-left: 8px;
        }
        .pulse-green-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent-green);
          box-shadow: 0 0 8px rgba(16, 185, 129, 0.8);
          animation: pulseDot 2s infinite;
        }
        @keyframes pulseDot {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.6; }
        }

        .window-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 6px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.12s ease;
        }
        .window-close-btn:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }

        /* Main Window Layout */
        .window-body {
          flex: 1;
          display: flex;
          overflow: hidden;
        }

        /* Left Master Sidebar */
        .conn-sidebar {
          width: 270px;
          background: var(--bg-sidebar);
          border-right: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
        }
        .sidebar-top-action {
          padding: 12px 14px;
          border-bottom: 1px solid var(--border-light);
        }
        .new-conn-btn {
          width: 100%;
          height: 32px;
          font-size: 12px;
          font-weight: 600;
          gap: 6px;
          border-radius: 6px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
        }

        .sidebar-scrollable-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .empty-profiles-notice {
          padding: 32px 16px;
          text-align: center;
          color: var(--text-muted);
          font-size: 11px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .empty-icon { opacity: 0.4; }

        .conn-group-section {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .conn-group-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 5px 8px;
          border-radius: 5px;
          cursor: pointer;
          color: var(--text-sub);
          font-size: 11px;
          font-weight: 600;
          user-select: none;
          transition: all 0.12s ease;
        }
        .conn-group-header:hover {
          background: var(--bg-hover);
          color: var(--text-main);
        }
        .group-header-left {
          display: flex;
          align-items: center;
          gap: 6px;
          overflow: hidden;
          flex: 1;
        }
        .group-arrow-icon { color: var(--text-muted); display: flex; }
        .group-folder-icon { color: var(--accent-blue); flex-shrink: 0; }
        .group-name-text {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .group-count-badge {
          font-size: 9.5px;
          color: var(--text-muted);
          background: var(--bg-tertiary);
          padding: 1px 5px;
          border-radius: 8px;
          border: 1px solid var(--border-light);
        }

        .group-quick-actions {
          display: none;
          align-items: center;
          gap: 2px;
        }
        .conn-group-header:hover .group-quick-actions {
          display: flex;
        }
        .group-tool-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          padding: 2px 4px;
          border-radius: 3px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.1s ease;
        }
        .group-tool-btn:hover {
          background: var(--bg-tertiary);
          color: var(--text-main);
        }
        .group-tool-btn.danger-tool:hover {
          color: var(--accent-red);
        }

        .conn-items-list {
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding-left: 10px;
        }

        .conn-card-item {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 7px 10px;
          border-radius: 7px;
          cursor: pointer;
          border: 1px solid transparent;
          background: transparent;
          transition: all 0.12s ease;
          position: relative;
        }
        .conn-card-item:hover {
          background: var(--bg-hover);
        }
        .conn-card-item.active {
          background: var(--bg-tertiary);
          border-color: var(--border-medium);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        .conn-card-item.is-connected {
          border-left: 3px solid var(--accent-green);
        }
        .conn-card-item.is-draft-card {
          border: 1px dashed var(--border-focus);
          background: var(--bg-hover);
        }

        .engine-avatar {
          width: 24px;
          height: 24px;
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          position: relative;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          color: var(--text-muted);
        }
        .postgres-avatar, .mariadb-avatar, .sqlite-avatar, .new-avatar {
          color: var(--text-muted);
          background: var(--bg-tertiary);
          border-color: var(--border-light);
        }

        .avatar-online-dot {
          position: absolute;
          top: -2px;
          right: -2px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent-green);
        }

        .conn-card-info {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          flex: 1;
          gap: 2px;
        }
        .card-top-line {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 4px;
        }
        .card-title {
          font-size: 11.5px;
          font-weight: 500;
          color: var(--text-main);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .connected-tag {
          font-size: 8.5px;
          font-weight: 600;
          color: var(--accent-green);
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          padding: 0.5px 4px;
          border-radius: 3px;
          text-transform: uppercase;
        }
        .draft-pill {
          font-size: 8.5px;
          font-weight: 500;
          color: var(--text-muted);
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          padding: 0.5px 4px;
          border-radius: 3px;
        }
        .card-subtitle {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 10px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .engine-type-tag {
          font-size: 8.5px;
          font-family: var(--font-mono);
          font-weight: 500;
          padding: 0.5px 3.5px;
          border-radius: 3px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-muted);
        }

        .host-text {
          font-family: var(--font-mono);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .quick-zap-btn {
          display: none;
          position: absolute;
          right: 8px;
          background: var(--btn-primary-bg);
          color: var(--btn-primary-text);
          border: none;
          border-radius: 4px;
          padding: 3px 6px;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .conn-card-item:hover .quick-zap-btn {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .quick-zap-btn:hover {
          background: var(--btn-primary-hover);
        }

        /* Right Detail / Form Panel */
        .conn-editor-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: var(--bg-content);
          overflow: hidden;
        }

        .editor-content-area {
          flex: 1;
          padding: 20px 24px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .active-profile-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
        }
        .banner-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .banner-msg {
          font-size: 11.5px;
          color: var(--text-sub);
        }
        .btn-disconnect-chip {
          background: transparent;
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #f87171;
          font-size: 10.5px;
          font-weight: 500;
          padding: 2px 7px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          gap: 4px;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .btn-disconnect-chip:hover {
          background: rgba(239, 68, 68, 0.12);
        }

        .form-section-card {
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .section-label {
          font-size: 10.5px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          color: var(--text-muted);
        }

        /* Database Type Segmented Control */
        .engine-segmented-control {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          background: var(--bg-tertiary);
          padding: 2px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-light);
          gap: 3px;
        }
        .engine-seg-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding: 6px 10px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--text-sub);
          font-size: 11.5px;
          font-weight: 500;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .engine-seg-btn:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }
        .engine-seg-btn.active {
          background: var(--bg-card);
          color: var(--text-main);
          font-weight: 600;
          border-color: var(--border-light);
          box-shadow: var(--shadow-sm);
        }

        .field-grid-2 {
          display: flex;
          gap: 10px;
        }
        .flex-1 { flex: 1; }
        .flex-2 { flex: 2; }
        .mt-12 { margin-top: 8px; }

        .field-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
        }
        .field-label {
          font-size: 11px;
          font-weight: 500;
          color: var(--text-sub);
        }
        .field-switch {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          cursor: pointer;
          user-select: none;
        }
        .field-switch input[type="checkbox"] {
          width: 13px;
          height: 13px;
          margin: 1px 0 0;
          accent-color: var(--accent-blue);
          cursor: pointer;
          flex-shrink: 0;
        }
        .field-switch-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .field-switch-title {
          font-size: 11px;
          font-weight: 500;
          color: var(--text-sub);
        }
        .field-switch-hint {
          font-size: 10px;
          line-height: 1.4;
          color: var(--text-muted);
        }
        .form-input, .form-select {
          width: 100%;
          height: 28px;
          font-size: 11.5px;
          border-radius: var(--radius-sm);
        }
        .form-input.input-invalid,
        .form-input.input-invalid:focus {
          border-color: var(--accent-red);
          box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.16);
        }
        .field-error-hint {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          line-height: 1.4;
          color: var(--accent-red);
        }

        .custom-group-input-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }
        .btn-clear-group {
          position: absolute;
          right: 6px;
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 11px;
          padding: 2px 4px;
        }
        .btn-clear-group:hover { color: var(--text-main); }

        .file-input-group {
          display: flex;
          gap: 6px;
          align-items: center;
        }
        .browse-file-btn {
          flex-shrink: 0;
          height: 28px;
          font-size: 11px;
          gap: 4px;
        }

        .status-feedback-box {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 8px 12px;
          border-radius: var(--radius-xs);
          font-size: 11.5px;
        }
        .feedback-content-left {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          min-width: 0;
        }
        .feedback-icon {
          flex-shrink: 0;
        }
        .status-feedback-box.success {
          background: var(--bg-tertiary);
          color: var(--accent-green);
          border: 1px solid var(--border-light);
        }
        .status-feedback-box.error {
          background: var(--bg-tertiary);
          color: var(--accent-rose);
          border: 1px solid rgba(244, 63, 94, 0.3);
        }
        .feedback-text {
          font-weight: 500;
          word-break: break-word;
          user-select: text;
        }
        .btn-feedback-copy {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 7px;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-xs);
          font-size: 10px;
          color: var(--text-main);
          cursor: pointer;
          flex-shrink: 0;
          transition: all 0.12s ease;
        }
        .btn-feedback-copy:hover {
          background: var(--bg-hover);
          border-color: var(--text-muted);
        }

        /* Sticky Footer Bar */
        .editor-footer-bar {
          padding: 10px 20px;
          background: var(--bg-header);
          border-top: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .footer-left { display: flex; align-items: center; }
        .footer-right { display: flex; align-items: center; gap: 6px; }

        .btn-del-profile {
          background: transparent;
          border: 1px solid var(--border-light);
          color: var(--text-muted);
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 8px;
          border-radius: var(--radius-sm);
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .btn-del-profile:hover {
          background: rgba(239, 68, 68, 0.1);
          color: #f87171;
          border-color: rgba(239, 68, 68, 0.3);
        }

        .test-btn, .save-btn {
          height: 28px;
          font-size: 11.5px;
        }
        .connect-main-btn {
          height: 28px;
          font-size: 11.5px;
          font-weight: 600;
          padding: 0 14px;
          gap: 5px;
        }

        /* Context Menu Styles */
        .group-context-menu {
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-popup);
          padding: 4px;
          min-width: 180px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          user-select: none;
        }
        .context-menu-header {
          padding: 5px 8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .context-group-title {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-main);
        }
        .context-menu-divider {
          height: 1px;
          background: var(--border-light);
          margin: 3px 0;
        }
        .context-menu-item {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 5px 8px;
          background: transparent;
          border: none;
          border-radius: var(--radius-sm);
          color: var(--text-main);
          font-size: 11px;
          cursor: pointer;
          text-align: left;
          width: 100%;
          transition: all 0.12s ease;
        }
        .context-menu-item:hover {
          background: var(--bg-hover);
        }
        .context-menu-item.danger:hover {
          background: rgba(239, 68, 68, 0.1);
          color: #f87171;
        }

        /* Submodal Dialogs */
        .submodal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
        }
        .submodal-card {
          width: 400px;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: 10px;
          box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45);
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .submodal-header {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13.5px;
          font-weight: 700;
          color: var(--text-main);
        }
        .submodal-header.danger-header {
          color: var(--accent-red);
        }
        .danger-icon { color: var(--accent-red); }
        .submodal-desc {
          font-size: 12px;
          color: var(--text-main);
          line-height: 1.45;
        }
        .submodal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
        .submodal-column-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .submodal-btn-choice {
          display: flex;
          align-items: center;
          gap: 8px;
          justify-content: flex-start;
          padding: 8px 12px;
          font-size: 11.5px;
          height: auto;
          text-align: left;
        }
        .cancel-choice-btn {
          margin-top: 4px;
          justify-content: center;
        }

        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};
