import * as TestingLibraryReact from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HostManagerDialog } from './HostManagerDialog';
import { useHostSources } from '@/hooks/useHostSources';

type RenderFn = (ui: React.ReactElement) => unknown;
type Screen = {
    getByText: (text: string | RegExp) => HTMLElement;
    getByTestId: (testId: string) => HTMLElement;
    getByRole: (role: string, options?: unknown) => HTMLElement;
    queryByText: (text: string | RegExp) => HTMLElement | null;
};
type WithinFn = (element: HTMLElement) => {
    getByRole: (role: string, options?: unknown) => HTMLElement;
    queryByRole: (role: string, options?: unknown) => HTMLElement | null;
};

const tlReact = TestingLibraryReact as unknown as {
    render: RenderFn,
    screen: Screen,
    within: WithinFn
};
const { render, screen, within } = tlReact;

let mockAddRemoteHostCalls: unknown[][] = [];
let mockEditRemoteHostCalls: unknown[][] = [];
let mockDeleteRemoteHostCalls: unknown[][] = [];
let mockToggleRemoteHostCalls: unknown[][] = [];

type HostSourcesState = ReturnType<typeof useHostSources>;

function createHostSourcesState(): HostSourcesState {
    return {
        sources: [
            { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            { hostId: 'remote-1', hostLabel: 'Test Remote', hostKind: 'remote', baseUrl: 'http://test.com', enabled: true },
            { hostId: 'remote-2', hostLabel: 'Another Remote', hostKind: 'remote', baseUrl: 'http://another.com', enabled: false },
        ],
        enabledSources: [
            { hostId: 'local', hostLabel: 'Local', hostKind: 'local' },
            { hostId: 'remote-1', hostLabel: 'Test Remote', hostKind: 'remote', baseUrl: 'http://test.com', enabled: true },
        ],
        remoteHosts: [
            { hostId: 'remote-1', hostLabel: 'Test Remote', baseUrl: 'http://test.com', enabled: true },
            { hostId: 'remote-2', hostLabel: 'Another Remote', baseUrl: 'http://another.com', enabled: false },
        ],
        activeFilter: 'all',
        activeSource: null,
        filteredHostIds: null,
        setActiveFilter: () => {},
        addRemoteHost: (...args: unknown[]) => mockAddRemoteHostCalls.push(args),
        editRemoteHost: (...args: unknown[]) => mockEditRemoteHostCalls.push(args),
        deleteRemoteHost: (...args: unknown[]) => mockDeleteRemoteHostCalls.push(args),
        toggleRemoteHost: (...args: unknown[]) => mockToggleRemoteHostCalls.push(args),
    };
}

const noop = () => {};

describe('HostManagerDialog', () => {
    let hostSourcesState: HostSourcesState;

    beforeEach(() => {
        mockAddRemoteHostCalls = [];
        mockEditRemoteHostCalls = [];
        mockDeleteRemoteHostCalls = [];
        mockToggleRemoteHostCalls = [];
        hostSourcesState = createHostSourcesState();
    });

    it('renders local row and does not allow editing or deleting local', () => {
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} />);

        const localRow = screen.getByTestId('host-row-local');
        expect(localRow).toBeTruthy();
        expect(within(localRow).queryByRole('button', { name: /edit/i })).toBeNull();
        expect(within(localRow).queryByRole('button', { name: /delete/i })).toBeNull();
    });

    it('adds a remote host', async () => {
        const user = userEvent.setup();
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} />);

        await user.click(screen.getByRole('button', { name: /add remote host/i }));

        const labelInput = screen.getByTestId('host-form-label');
        const urlInput = screen.getByTestId('host-form-base-url');

        await user.type(labelInput, 'New Host');
        await user.type(urlInput, 'http://new-host.com');

        await user.click(screen.getByRole('button', { name: /add host/i }));

        expect(mockAddRemoteHostCalls.length).toBeGreaterThan(0);
        const addedHost = mockAddRemoteHostCalls[0][0] as { hostLabel: string, baseUrl: string, enabled: boolean };
        expect(addedHost.hostLabel).toBe('New Host');
        expect(addedHost.baseUrl).toBe('http://new-host.com');
        expect(addedHost.enabled).toBe(true);
    });

    it('normalizes host data before submit', async () => {
        const user = userEvent.setup();
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} />);

        await user.click(screen.getByRole('button', { name: /add remote host/i }));

        const labelInput = screen.getByTestId('host-form-label');
        const urlInput = screen.getByTestId('host-form-base-url');

        await user.type(labelInput, '  New Host  ');
        await user.type(urlInput, '  https://new-host.com///  ');

        await user.click(screen.getByRole('button', { name: /add host/i }));

        expect(mockAddRemoteHostCalls.length).toBeGreaterThan(0);
        const addedHost = mockAddRemoteHostCalls[0][0] as { hostLabel: string, baseUrl: string, enabled: boolean };
        expect(addedHost.hostLabel).toBe('New Host');
        expect(addedHost.baseUrl).toBe('https://new-host.com');
        expect(addedHost.enabled).toBe(true);
    });

    it('edits a remote host', async () => {
        const user = userEvent.setup();
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} />);

        const testRemoteRow = screen.getByTestId('host-row-remote-remote-1');
        await user.click(within(testRemoteRow).getByRole('button', { name: /edit host/i }));

        const labelInput = screen.getByTestId('host-form-label');
        await user.clear(labelInput);
        await user.type(labelInput, 'Updated Host');

        await user.click(within(testRemoteRow).getByRole('button', { name: /save/i }));

        expect(mockEditRemoteHostCalls.length).toBeGreaterThan(0);
        const editArgs = mockEditRemoteHostCalls[0] as [string, { hostLabel: string, baseUrl: string }];
        expect(editArgs[0]).toBe('remote-1');
        expect(editArgs[1].hostLabel).toBe('Updated Host');
        expect(editArgs[1].baseUrl).toBe('http://test.com');
    });

    it('deletes a remote host', async () => {
        const user = userEvent.setup();
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} />);

        const testRemoteRow = screen.getByTestId('host-row-remote-remote-1');
        await user.click(within(testRemoteRow).getByRole('button', { name: /delete host/i }));

        expect(mockDeleteRemoteHostCalls.length).toBeGreaterThan(0);
        expect(mockDeleteRemoteHostCalls[0][0]).toBe('remote-1');
    });

    it('toggles a remote host', async () => {
        const user = userEvent.setup();
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} />);

        const testRemoteRow = screen.getByTestId('host-row-remote-remote-1');
        await user.click(within(testRemoteRow).getByRole('button', { name: /disable/i }));

        expect(mockToggleRemoteHostCalls.length).toBeGreaterThan(0);
        expect(mockToggleRemoteHostCalls[0][0]).toBe('remote-1');
    });

    it('validates URLs on add', async () => {
        const user = userEvent.setup();
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} />);

        await user.click(screen.getByRole('button', { name: /add remote host/i }));

        const labelInput = screen.getByTestId('host-form-label');
        const urlInput = screen.getByTestId('host-form-base-url');

        await user.type(labelInput, 'Invalid Host');
        await user.type(urlInput, 'not-a-url');

        await user.click(screen.getByRole('button', { name: /add host/i }));

        expect(screen.queryByText(/valid base URL is required/i)).toBeTruthy();
        expect(mockAddRemoteHostCalls.length).toBe(0);
    });

    it('rejects ftp and credentialed URLs on add', async () => {
        const user = userEvent.setup();
        render(<HostManagerDialog open={true} onClose={noop} hostSources={hostSourcesState} />);

        await user.click(screen.getByRole('button', { name: /add remote host/i }));

        const labelInput = screen.getByTestId('host-form-label');
        const urlInput = screen.getByTestId('host-form-base-url');

        await user.type(labelInput, 'Invalid Host');
        await user.type(urlInput, 'ftp://bad-host.test');
        await user.click(screen.getByRole('button', { name: /add host/i }));

        expect(screen.queryByText(/must use http:\/\/ or https:\/\//i)).toBeTruthy();
        expect(mockAddRemoteHostCalls.length).toBe(0);

        await user.clear(urlInput);
        await user.type(urlInput, 'https://user:pass@bad-host.test');
        await user.click(screen.getByRole('button', { name: /add host/i }));

        expect(screen.queryByText(/must not include a username or password/i)).toBeTruthy();
        expect(mockAddRemoteHostCalls.length).toBe(0);
    });
});
