# Avatar Component - Usage Examples

生产级别的头像组件，支持图片头像、文字头像、上传、群组等功能。

## 功能特性

### ✅ 基础功能
- 图片头像（支持 URL、本地路径）
- 文字头像（自动生成首字母，颜色根据名字哈希生成）
- 图标头像（默认 fallback）
- 自定义 fallback

### ✅ 尺寸支持（7 种）
- `xs` (24px)
- `sm` (32px)
- `md` (40px)
- `lg` (48px)
- `xl` (64px)
- `2xl` (80px)
- `3xl` (96px)

### ✅ 形状支持（3 种）
- `circle` - 圆形
- `square` - 方形
- `rounded` - 圆角方形

### ✅ 状态管理
- 自动加载状态
- 错误状态处理
- 手动状态控制

### ✅ 在线状态指示
- online（绿色）
- offline（灰色）
- busy（红色）
- away（黄色）

### ✅ 上传功能
- 点击上传
- 拖拽上传
- 文件类型验证
- 文件大小验证
- 上传进度
- 删除头像

### ✅ 群组头像
- 显示多个头像
- 最大数量限制
- 溢出计数显示
- 重叠排列

---

## 使用示例

### 1. 基础用法

```jsx
import Avatar from "./ui/Avatar.jsx";

// 图片头像
<Avatar src="https://example.com/avatar.jpg" alt="John Doe" />

// 文字头像（自动生成首字母）
<Avatar name="John Doe" />

// 文字头像（中文）
<Avatar name="张三" />

// 默认图标头像
<Avatar />
```

### 2. 不同尺寸

```jsx
<Avatar src={url} size="xs" />
<Avatar src={url} size="sm" />
<Avatar src={url} size="md" />
<Avatar src={url} size="lg" />
<Avatar src={url} size="xl" />
<Avatar src={url} size="2xl" />
<Avatar src={url} size="3xl" />
```

### 3. 不同形状

```jsx
<Avatar src={url} shape="circle" />  // 圆形
<Avatar src={url} shape="square" />  // 方形
<Avatar src={url} shape="rounded" /> // 圆角
```

### 4. 在线状态

```jsx
// 显示在线状态
<Avatar src={url} showStatus statusColor="online" />

// 其他状态
<Avatar src={url} showStatus statusColor="offline" />
<Avatar src={url} showStatus statusColor="busy" />
<Avatar src={url} showStatus statusColor="away" />
```

### 5. 可点击头像

```jsx
<Avatar
  src={url}
  onClick={(e) => {
    console.log("Avatar clicked");
  }}
/>
```

### 6. 可编辑头像（支持上传）

```jsx
import Avatar from "./ui/Avatar.jsx";

function UserProfile() {
  const [avatarUrl, setAvatarUrl] = useState(null);

  const handleUpload = async (file) => {
    // 上传到服务器或本地存储
    const formData = new FormData();
    formData.append("avatar", file);
    
    const response = await fetch("/api/upload-avatar", {
      method: "POST",
      body: formData,
    });
    
    const data = await response.json();
    setAvatarUrl(data.url);
  };

  const handleDelete = async () => {
    // 删除头像
    await fetch("/api/delete-avatar", { method: "DELETE" });
    setAvatarUrl(null);
  };

  return (
    <Avatar
      src={avatarUrl}
      name="John Doe"
      size="xl"
      editable
      onUpload={handleUpload}
      onDelete={handleDelete}
      maxSize={5 * 1024 * 1024} // 5MB
      accept="image/*"
    />
  );
}
```

### 7. 完整上传 UI（AvatarUpload）

```jsx
import { AvatarUpload } from "./ui/Avatar.jsx";

function ProfileEditor() {
  const [avatarUrl, setAvatarUrl] = useState(null);

  return (
    <AvatarUpload
      src={avatarUrl}
      name="John Doe"
      size="xl"
      onUpload={async (file) => {
        // 上传逻辑
        const url = await uploadFile(file);
        setAvatarUrl(url);
      }}
      onDelete={async () => {
        // 删除逻辑
        await deleteAvatar();
        setAvatarUrl(null);
      }}
      maxSize={5 * 1024 * 1024}
      accept="image/*"
    />
  );
}
```

**AvatarUpload 特性：**
- ✅ 拖拽上传支持
- ✅ 预览功能
- ✅ 上传按钮
- ✅ 删除按钮
- ✅ 文件大小提示
- ✅ 错误提示

### 8. 群组头像

```jsx
import Avatar, { AvatarGroup } from "./ui/Avatar.jsx";

function TeamList() {
  const members = [
    { id: 1, name: "Alice", avatar: "url1" },
    { id: 2, name: "Bob", avatar: "url2" },
    { id: 3, name: "Charlie", avatar: "url3" },
    { id: 4, name: "David", avatar: "url4" },
    { id: 5, name: "Eve", avatar: "url5" },
    { id: 6, name: "Frank", avatar: "url6" },
  ];

  return (
    <AvatarGroup size="md" shape="circle" max={4}>
      {members.map(member => (
        <Avatar
          key={member.id}
          src={member.avatar}
          name={member.name}
          size="md"
          shape="circle"
        />
      ))}
    </AvatarGroup>
  );
}
```

**输出效果：**
- 显示前 4 个头像
- 第 5、6 个头像显示为 `+2` 溢出指示器
- 头像重叠排列，从左到右

### 9. 自定义 Fallback

```jsx
import { User2 } from "lucide-react";

<Avatar
  fallback={<User2 className="text-blue-500" />}
/>
```

### 10. 加载控制

```jsx
// 懒加载
<Avatar src={url} loading="lazy" />

// 立即加载
<Avatar src={url} loading="eager" />

// 手动控制状态
<Avatar
  src={url}
  status="loading"
  onLoad={() => console.log("Loaded")}
  onError={() => console.log("Error")}
/>
```

### 11. 自定义样式

```jsx
<Avatar
  src={url}
  className="border-2 border-blue-500"
  imgClassName="object-cover"
/>
```

---

## API 文档

### Avatar Props

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `src` | `string \| null` | - | 头像图片 URL |
| `alt` | `string` | `""` | 图片 alt 文本 |
| `name` | `string` | - | 用户名（用于生成文字头像） |
| `fallback` | `ReactNode` | `<User />` | 自定义 fallback |
| `size` | `"xs" \| "sm" \| "md" \| "lg" \| "xl" \| "2xl" \| "3xl"` | `"md"` | 头像尺寸 |
| `shape` | `"circle" \| "square" \| "rounded"` | `"circle"` | 头像形状 |
| `className` | `string` | - | 容器类名 |
| `imgClassName` | `string` | - | 图片类名 |
| `loading` | `"lazy" \| "eager"` | `"lazy"` | 图片加载策略 |
| `onLoad` | `() => void` | - | 加载成功回调 |
| `onError` | `() => void` | - | 加载失败回调 |
| `onClick` | `(e: MouseEvent) => void` | - | 点击回调 |
| `status` | `"idle" \| "loading" \| "loaded" \| "error"` | - | 手动状态控制 |
| `showStatus` | `boolean` | `false` | 显示在线状态 |
| `statusColor` | `"online" \| "offline" \| "busy" \| "away"` | `"online"` | 状态颜色 |
| `editable` | `boolean` | `false` | 可编辑（支持上传） |
| `onUpload` | `(file: File) => void \| Promise<void>` | - | 上传回调 |
| `onDelete` | `() => void \| Promise<void>` | - | 删除回调 |
| `accept` | `string` | `"image/*"` | 接受的文件类型 |
| `maxSize` | `number` | `5242880` (5MB) | 最大文件大小 |

### AvatarGroup Props

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `children` | `ReactNode` | - | Avatar 子组件 |
| `max` | `number` | `4` | 最大显示数量 |
| `size` | `AvatarSize` | `"md"` | 头像尺寸 |
| `shape` | `AvatarShape` | `"circle"` | 头像形状 |
| `className` | `string` | - | 容器类名 |

### AvatarUpload Props

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `src` | `string \| null` | - | 头像 URL |
| `name` | `string` | - | 用户名 |
| `onUpload` | `(file: File) => void \| Promise<void>` | - | 上传回调（必需） |
| `onDelete` | `() => void \| Promise<void>` | - | 删除回调 |
| `size` | `AvatarSize` | `"xl"` | 头像尺寸 |
| `shape` | `AvatarShape` | `"circle"` | 头像形状 |
| `accept` | `string` | `"image/*"` | 接受的文件类型 |
| `maxSize` | `number` | `5242880` (5MB) | 最大文件大小 |
| `className` | `string` | - | 容器类名 |

---

## 完整示例

### 用户资料卡片

```jsx
import Avatar, { AvatarUpload } from "./ui/Avatar.jsx";
import { useState } from "react";

function UserProfileCard({ user }) {
  const [avatarUrl, setAvatarUrl] = useState(user.avatar);

  return (
    <div className="rounded-lg border border-[var(--os-border)] bg-[var(--os-bg-panel)] p-6">
      <div className="flex items-start gap-4">
        {/* 头像 */}
        <AvatarUpload
          src={avatarUrl}
          name={user.name}
          size="xl"
          shape="circle"
          onUpload={async (file) => {
            const formData = new FormData();
            formData.append("avatar", file);
            const res = await fetch("/api/avatar", {
              method: "POST",
              body: formData,
            });
            const data = await res.json();
            setAvatarUrl(data.url);
          }}
          onDelete={async () => {
            await fetch("/api/avatar", { method: "DELETE" });
            setAvatarUrl(null);
          }}
        />

        {/* 用户信息 */}
        <div className="flex-1">
          <h3 className="text-lg font-semibold">{user.name}</h3>
          <p className="text-sm text-[var(--os-text-muted)]">{user.email}</p>
          <p className="text-sm text-[var(--os-text-muted)]">{user.role}</p>
        </div>
      </div>
    </div>
  );
}
```

### 团队成员列表

```jsx
import Avatar, { AvatarGroup } from "./ui/Avatar.jsx";

function TeamCard({ team }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{team.name}</h3>
          <p className="text-sm text-[var(--os-text-muted)]">
            {team.members.length} members
          </p>
        </div>

        {/* 群组头像 */}
        <AvatarGroup size="sm" max={3}>
          {team.members.map(member => (
            <Avatar
              key={member.id}
              src={member.avatar}
              name={member.name}
              size="sm"
              showStatus
              statusColor={member.status}
            />
          ))}
        </AvatarGroup>
      </div>
    </div>
  );
}
```

### 聊天列表

```jsx
import Avatar from "./ui/Avatar.jsx";

function ChatList({ chats }) {
  return (
    <div className="space-y-2">
      {chats.map(chat => (
        <div
          key={chat.id}
          className="flex items-center gap-3 rounded-lg p-2 hover:bg-[var(--os-bg-hover)]"
        >
          <Avatar
            src={chat.avatar}
            name={chat.name}
            size="md"
            showStatus
            statusColor={chat.status}
          />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{chat.name}</p>
            <p className="text-sm text-[var(--os-text-muted)] truncate">
              {chat.lastMessage}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## 最佳实践

### 1. 始终提供 name 属性
即使有图片头像，也应该提供 name 属性作为 fallback：
```jsx
<Avatar src={url} name="John Doe" />
```

### 2. 文件大小限制
建议最大文件大小为 5MB（已设为默认值）：
```jsx
<Avatar
  editable
  onUpload={handleUpload}
  maxSize={5 * 1024 * 1024} // 5MB
/>
```

### 3. 优雅的上传体验
使用 AvatarUpload 组件提供完整的上传 UI：
```jsx
<AvatarUpload
  src={url}
  name="John Doe"
  onUpload={handleUpload}
  onDelete={handleDelete}
/>
```

### 4. 群组头像数量
建议 max 值为 3-5：
```jsx
<AvatarGroup max={4}>
  {members.map(...)}
</AvatarGroup>
```

### 5. 错误处理
提供 onError 回调处理图片加载失败：
```jsx
<Avatar
  src={url}
  onError={() => {
    console.warn("Avatar failed to load");
  }}
/>
```

---

## 注意事项

1. **文字头像颜色**：根据 name 哈希生成，相同 name 总是显示相同颜色
2. **首字母提取**：英文取首尾字母（John Doe → JD），中文取首字（张三 → 张）
3. **上传状态**：上传时会自动显示 loading 状态
4. **拖拽上传**：AvatarUpload 支持拖拽，普通 Avatar 不支持
5. **群组头像**：children 必须是 Avatar 组件实例

---

## 与项目集成

Avatar 组件已遵循项目规范：
- ✅ 使用 Tailwind CSS + CSS 变量（`--os-*`）
- ✅ 使用 `cn()` 工具函数合并类名
- ✅ 使用 lucide-react 图标库
- ✅ 复用 `.os-image__spinner` 样式
- ✅ JSDoc 类型注释
- ✅ 无障碍支持（aria-label, aria-checked 等）
- ✅ Keyboard 可访问（focus-visible ring）

---

文件位置：`D:\HuaweiMoveData\Users\admin\Desktop\openStudio\src\ui\Avatar.jsx`