'use client';

import { useState } from 'react';
import { useAuthStore } from '@/lib/store/auth-store';
import { apiClient } from '@/lib/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Loader2, User, KeyRound, ShieldCheck } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

export default function ProfilePage() {
  const { user, fetchUser } = useAuthStore();

  const [name, setName] = useState(user?.full_name ?? '');
  const [nameSaving, setNameSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(user?.is_admin ?? false);
  const [adminSaving, setAdminSaving] = useState(false);

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const handleToggleAdmin = async (checked: boolean) => {
    setIsAdmin(checked);
    setAdminSaving(true);
    try {
      await apiClient.patch('/api/v1/auth/me', { is_admin: checked });
      await fetchUser();
      toast.success(checked ? 'Admin permission enabled' : 'Admin permission disabled');
    } catch (e: unknown) {
      setIsAdmin(!checked);
      toast.error(e instanceof Error ? e.message : 'Failed to update permission');
    } finally {
      setAdminSaving(false);
    }
  };

  const handleSaveName = async () => {
    setNameSaving(true);
    try {
      await apiClient.patch('/api/v1/auth/me', { full_name: name });
      await fetchUser();
      toast.success('Name updated');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to update name');
    } finally {
      setNameSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPw !== confirmPw) { toast.error('New passwords do not match'); return; }
    if (newPw.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setPwSaving(true);
    try {
      await apiClient.patch('/api/v1/auth/me', { current_password: currentPw, new_password: newPw });
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      toast.success('Password changed');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to change password');
    } finally {
      setPwSaving(false);
    }
  };

  if (!user) return null;

  const nameDirty = name !== (user.full_name ?? '');

  return (
    <div className="max-w-xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-muted-foreground text-sm">Manage your account details</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" /> Account Info
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium">Email</label>
            <Input value={user.email} disabled className="bg-muted text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Full Name</label>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
              />
              <Button onClick={handleSaveName} disabled={!nameDirty || nameSaving} className="shrink-0">
                {nameSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
              </Button>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Member since {new Date(user.created_at).toLocaleDateString()}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Permissions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Admin Access</p>
              <p className="text-xs text-muted-foreground">Enables admin panel and management features</p>
            </div>
            <div className="flex items-center gap-2">
              {adminSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              <Switch
                checked={isAdmin}
                onCheckedChange={handleToggleAdmin}
                disabled={adminSaving}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Change Password
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium">Current Password</label>
            <Input
              type="password"
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              placeholder="Enter current password"
            />
          </div>
          <Separator />
          <div className="space-y-1">
            <label className="text-xs font-medium">New Password</label>
            <Input
              type="password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              placeholder="Min 8 characters"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Confirm New Password</label>
            <Input
              type="password"
              value={confirmPw}
              onChange={e => setConfirmPw(e.target.value)}
              placeholder="Repeat new password"
            />
          </div>
          <Button
            onClick={handleChangePassword}
            disabled={!currentPw || !newPw || !confirmPw || pwSaving}
            className="w-full"
          >
            {pwSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Change Password
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
