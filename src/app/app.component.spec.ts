import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { Link } from './links.service';

describe('Snip frontend', () => {
  let fixture: ComponentFixture<AppComponent>;
  let app: AppComponent;
  let http: HttpTestingController;
  let page: HTMLElement;
  const link: Link = {
    code: 'Ab12Cd',
    url: 'https://example.com/a-long-link',
    shortUrl: 'http://localhost:3000/Ab12Cd',
    hits: 0,
    createdAt: '2026-11-16T00:00:00.000Z'
  };
  const listRequest = () => http.expectOne({ method: 'GET', url: '/api/links' });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();
    fixture = TestBed.createComponent(AppComponent);
    app = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    page = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('announces loading and an empty list', () => {
    expect(page.textContent).toContain('Loading links...');
    listRequest().flush([]);
    fixture.detectChanges();
    expect(page.textContent).toContain('No links yet.');
    expect(page.querySelector('table')).toBeNull();
  });

  it('rejects missing, invalid and non-HTTP(S) URLs without submitting', () => {
    listRequest().flush([]);
    for (const value of ['', 'not a URL', 'ftp://example.com', 'javascript:alert(1)', 'https://exa\nmple.com']) {
      app.form.controls.url.setValue(value);
      app.submit();
      fixture.detectChanges();
      expect(app.form.invalid).withContext(value).toBeTrue();
      expect(page.querySelector('#url')?.getAttribute('aria-invalid')).toBe('true');
      http.expectNone((request) => request.method === 'POST');
    }
    for (const value of ['http://example.com', 'https://example.com/path?x=1']) {
      app.form.controls.url.setValue(value);
      expect(app.form.valid).withContext(value).toBeTrue();
    }
  });

  it('submits once while pending, trims input and refreshes the rendered table', () => {
    listRequest().flush([]);
    app.form.controls.url.setValue(`  ${link.url}  `);
    page.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(page.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBeTrue();
    expect(page.querySelector<HTMLInputElement>('#url')?.readOnly).toBeTrue();
    app.submit();
    const request = http.expectOne({ method: 'POST', url: '/api/links' });
    expect(request.request.body).toEqual({ url: link.url });
    request.flush(link, { status: 201, statusText: 'Created' });
    listRequest().flush([link]);
    fixture.detectChanges();
    expect(app.pending()).toBeFalse();
    expect(app.form.controls.url.value).toBe('');
    expect(page.querySelector('.success a')?.getAttribute('href')).toBe(link.shortUrl);
    expect(page.querySelector('tbody a')?.textContent).toBe(link.code);
    expect(page.querySelector('tbody .original')?.textContent).toContain(link.url);
    expect(page.querySelector('tbody .hits')?.textContent).toBe('0');
  });

  it('replaces an older list request after successful creation', () => {
    const initialRequest = listRequest();
    app.form.controls.url.setValue(link.url);
    app.submit();
    http.expectOne({ method: 'POST', url: '/api/links' }).flush(link);
    expect(initialRequest.cancelled).toBeTrue();
    listRequest().flush([link]);
    expect(app.links()).toEqual([link]);
    expect(app.loading()).toBeFalse();
  });

  it('keeps entered input and displays the server error beside it, allowing retry', () => {
    listRequest().flush([]);
    app.form.controls.url.setValue(link.url);
    app.submit();
    http.expectOne({ method: 'POST', url: '/api/links' })
      .flush({ error: 'Invalid URL' }, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(page.querySelector('#url-error')?.textContent).toBe('Invalid URL');
    expect(app.form.controls.url.value).toBe(link.url);
    expect(app.pending()).toBeFalse();
    app.form.controls.url.setValue('https://example.org');
    fixture.detectChanges();
    expect(page.querySelector('#url-error')).toBeNull();
    app.submit();
    http.expectOne({ method: 'POST', url: '/api/links' }).flush(link);
    listRequest().flush([link]);
  });

  it('reports a network failure instead of success', () => {
    listRequest().flush([]);
    app.form.controls.url.setValue(link.url);
    app.submit();
    http.expectOne({ method: 'POST', url: '/api/links' }).error(new ProgressEvent('error'));
    fixture.detectChanges();
    expect(page.querySelector('#url-error')?.textContent).toContain('Cannot reach the server');
    expect(page.querySelector('.success')).toBeNull();
    expect(app.pending()).toBeFalse();
  });

  it('preserves a successful result if list refresh fails and lets the user retry', () => {
    listRequest().flush([]);
    app.form.controls.url.setValue(link.url);
    app.submit();
    http.expectOne({ method: 'POST', url: '/api/links' }).flush(link);
    listRequest().flush('Unavailable', { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(page.querySelector('.success a')?.getAttribute('href')).toBe(link.shortUrl);
    expect(page.querySelector('[role="alert"]')?.textContent).toContain('Could not load links');
    page.querySelector<HTMLButtonElement>('.secondary')?.click();
    listRequest().flush([{ ...link, hits: 1 }]);
    fixture.detectChanges();
    expect(page.querySelector('[role="alert"]')).toBeNull();
    expect(page.querySelector('tbody .hits')?.textContent).toBe('1');
  });
});
