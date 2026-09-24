import { useEffect } from 'react';
import { useUser, useClerk } from '@clerk/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { releaseDriverCoaches, useUpdateDriverProfile } from '@/providers/driver-profile';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Link } from 'wouter';
import { useGetAdminAccess, getGetAdminAccessQueryKey } from '@workspace/api-client-react';
import { Loader2, LogOut, CheckCircle2, AlertCircle, ShieldAlert } from 'lucide-react';
import { appUrl } from '@/lib/app-routes';

const profileSchema = z.object({
  unitNumber: z.string().min(1, 'Unit number is required').max(20),
  phoneNumber: z.string().min(1, 'Phone number is required'),
});

export function DriverOnboarding() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const updateProfile = useUpdateDriverProfile();
  const hasAssignedUsername = Boolean(user?.username?.trim());

  const { data: adminAccess } = useGetAdminAccess({
    query: {
      queryKey: [...getGetAdminAccessQueryKey(), user?.id],
      retry: false,
      staleTime: 60000,
      enabled: !!user?.id,
    }
  });

  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      unitNumber: '',
      phoneNumber: '',
    },
  });

  useEffect(() => {
    if (user && !form.formState.isDirty) {
      form.reset({
        unitNumber: '',
        phoneNumber: user.primaryPhoneNumber?.phoneNumber || '',
      });
    }
  }, [user, form]);

  async function onSubmit(values: z.infer<typeof profileSchema>) {
    try {
      await updateProfile.mutateAsync(values);
      // The successful mutation fills the shared cache; the gate opens the console.
    } catch (err) {
      // Error handled by form state / mutation error
    }
  }

  async function handleSignOut() {
    try {
      await releaseDriverCoaches();
      window.dispatchEvent(new CustomEvent('driver-account-changed'));
      await signOut({ redirectUrl: appUrl('/sign-in') });
    } catch (err) {
      // If we can't release coaches, show an error and don't sign out
      console.error(err);
      alert('Could not release coaches. Please try again.');
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#f0f4f8] px-4 py-12">
      <Card className="w-full max-w-md shadow-xl border-[#e2e8f0]">
        <CardHeader className="bg-secondary text-secondary-foreground rounded-t-xl pb-8 pt-8">
          <CardTitle className="text-2xl font-black text-center tracking-tight">Driver Profile</CardTitle>
          <CardDescription className="text-secondary-foreground/80 text-center font-medium mt-2">
            Please complete your profile to continue
          </CardDescription>
        </CardHeader>
        
        <CardContent className="-mt-4 bg-white mx-4 rounded-xl shadow-sm border border-gray-100 p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {updateProfile.isError && (
                <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm font-bold border border-red-200 flex items-center gap-2">
                   <AlertCircle className="h-4 w-4 shrink-0" />
                   {updateProfile.error instanceof Error ? updateProfile.error.message : 'An error occurred'}
                </div>
              )}

              <div className="space-y-2">
                <dl className="space-y-2">
                  <dt className="text-sm text-[#0f172a] font-bold">Assigned Username</dt>
                  <dd className="flex h-11 items-center rounded-md border border-gray-200 bg-slate-100 px-3 font-semibold text-slate-700">
                    {user?.username || 'Not assigned'}
                  </dd>
                </dl>
                <p className="text-xs text-muted-foreground">
                  Your administrator assigns this username and the password used to sign in.
                </p>
              </div>

              {!hasAssignedUsername && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-5 text-amber-900">
                  Your driver account has not been assigned a username yet. Contact your administrator before completing this profile.
                </div>
              )}

              <FormField
                control={form.control}
                name="unitNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#0f172a] font-bold">Unit Number</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. 1045" {...field} className="h-11 font-medium bg-gray-50 border-gray-200 focus-visible:ring-primary" />
                    </FormControl>
                    <FormMessage className="font-bold text-red-600" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phoneNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#0f172a] font-bold">Phone Number</FormLabel>
                    <FormControl>
                      <Input placeholder="+1..." type="tel" {...field} className="h-11 font-medium bg-gray-50 border-gray-200 focus-visible:ring-primary" />
                    </FormControl>
                    <FormMessage className="font-bold text-red-600" />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-black text-lg shadow-md" disabled={updateProfile.isPending || !hasAssignedUsername}>
                {updateProfile.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
                Complete Profile
              </Button>
            </form>
          </Form>
        </CardContent>

        <CardFooter className="justify-center mt-4 pb-6 flex-col gap-2">
          {adminAccess?.authorized && (
            <Link href="/admin" className="w-full text-center">
              <Button variant="outline" className="w-full text-secondary border-secondary/20 hover:bg-secondary/10 font-bold">
                <ShieldAlert className="mr-2 h-4 w-4" /> Go to Admin Console
              </Button>
            </Link>
          )}
          <Button variant="ghost" className="text-[#64748b] hover:text-[#0f172a] font-bold" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
