---
title: 看懂 EXPLAIN：一条慢查询该从哪里下手
published: 2025-12-03
description: 逐列拆解 EXPLAIN 输出，给出从慢查询日志到索引优化的可执行顺序。
tags: [MySQL, 性能优化, 索引]
category: 数据库
series: MySQL 系列
seriesOrder: 4
---

一条 SQL 变慢，多数时候不是 MySQL 忽然不行了，而是它的执行计划和你的预期不一致：你以为走的是 `(user_id, status)` 上的联合索引，它实际扫了整张表。`EXPLAIN` 的价值就在这里——它不回答「哪台机器慢」，只回答「这条语句，优化器打算怎么读数据」。看懂之后排查顺序也就固定了：先确认有没有走索引，再看有没有多余的排序和临时表，最后才考虑改 SQL 或者加索引。

## 一、先把慢查询捞出来

慢查询日志是入口，不是答案。两个参数决定它有没有用：`slow_query_log` 控制开关，`long_query_time` 控制阈值。后者的默认值是 10 秒，而线上接口的目标耗时普遍在 100 毫秒级，用默认值基本什么都捞不到，实际会调到 0.1 甚至更低；日志写到 `slow_query_log_file` 指定的文件里。

开法有两条：写进 `my.cnf` 随服务启动生效，或者用 `SET GLOBAL` 动态打开、重启后失效。临时抓一波用后者，长期开用前者。

::: code-group labels=[my.cnf, SQL 动态开启]
```text
[mysqld]
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 0.1
```
```sql
set global slow_query_log = 1;
set global long_query_time = 0.1;
-- 新建立的连接才会读到新阈值
```
:::

日志有了，不要一条条读。`mysqldumpslow -s t -t 10` 按总耗时排序取前十条，`-s c` 按出现次数排序；数据量大时上 `pt-query-digest` 做更细的聚合。要区分两类记录：出现次数最多的通常落在高频路径上，单次耗时最高的多半是缺索引的范围查询或大排序。

> [!NOTE]
> 慢日志只记录「已经执行完」的语句。一条正卡在锁等待或大排序里的 SQL 还没结束，日志里就没有它，但业务早已超时。这时用 `show full processlist` 看 `Time` 和 `State`，`Waiting for table metadata lock` 这类状态比日志及时得多。

## 二、一行 EXPLAIN 说了什么

拿到目标 SQL，在它前面加一个 `explain`。假设订单表 `orders` 上有主键 `id`，以及联合索引 `idx_user_status_created (user_id, status, created_at)`：

```sql
explain
select id, user_id, amount
from orders
where user_id = 1024 and status = 1 and amount > 0
order by amount desc
limit 20;
```

输出是一张横向很长的表：

```text
+----+-------------+--------+------+-------------------------+-------------------------+---------+-------------+------+----------+-----------------------------+
| id | select_type | table  | type | possible_keys           | key                     | key_len | ref         | rows | filtered | Extra                       |
+----+-------------+--------+------+-------------------------+-------------------------+---------+-------------+------+----------+-----------------------------+
|  1 | SIMPLE      | orders | ref  | idx_user_status_created | idx_user_status_created |       5 | const,const | 1180 |    33.33 | Using where; Using filesort |
+----+-------------+--------+------+-------------------------+-------------------------+---------+-------------+------+----------+-----------------------------+
```

逐列看：

- `id` 与 `select_type`：这里是单表，所以是 `SIMPLE`。子查询、`union`、派生表会让它变成 `SUBQUERY`、`PRIMARY`、`DERIVED` 之类；有多行时按 `id` 从大到小、同 `id` 从上到下读。较新的 8.0 版本还可以 `explain format=tree` 看嵌套层级，比横表直观。
- `table`：这一行在访问哪张表，派生表会显示成 `<derived2>` 这样的名字。
- `type`：访问方式，整张表最重要的一列，下一节单独讲。
- `possible_keys`：优化器认为「可能用得上」的索引。注意它只是候选，不是结论。
- `key`：真正选中的索引。这一列是 `NULL` 而 `possible_keys` 不为空，说明索引存在但被优化器放弃了——这是最值得追的一种情况。
- `key_len`：用到的索引字节数，可以反推用了几列。这里的 5 = `user_id` 的 4 字节 + `status` 的 1 字节（`int` 与 `tinyint`），说明定位只用到前两列，`created_at` 完全没参与。
- `ref`：索引列在跟谁比较。`const` 是常量，`const,const` 表示前两列都在跟常量比。
- `rows`：估算的扫描行数，不是返回行数。它是抽样统计出来的估计值，不是精确计数。
- `filtered`：扫到的行里有多少百分比能通过剩余条件，`rows × filtered` 才是真正参与后续操作的行数。这里的 33.33 是优化器对 `amount > 0` 的选择性估计，1180 × 33.33% ≈ 393 行才是后面要排序、要回表的行数。早期版本缺统计信息时这一列经常直接显示 `100.00`，别把它当精确值。
- `Extra`：补充信息，信息量最大的一列，后面单独讲。

这一行其实已经说清了全部问题：索引用上了（`ref`），但只用到前两列；排序借不到索引顺序（`Using filesort`）；`amount` 不在索引里，取它还得回表（没有 `Using index`）。

## 三、type：从 system 到 ALL

```mermaid
flowchart LR
    S["system / const<br/>唯一一行"] --> E["eq_ref<br/>被驱动表按唯一键匹配"]
    E --> R["ref<br/>等值命中多行"]
    R --> G["range<br/>索引区间扫描"]
    G --> I["index<br/>扫整棵索引树"]
    I --> A["ALL<br/>扫整张表"]
```

从左到右，要访问的数据量一档比一档大。看到靠左的 `type` 一般可以放心，看到靠右的就要追问一句「为什么」。

- `system`：表里只有一行（系统表或只剩一行的派生表），优化阶段直接当常量处理，业务表里基本见不到。
- `const`：主键或唯一索引的等值查询，最多命中一行，优化器在读表之前就把值定了下来。`where id = 1` 属于这种。
- `eq_ref`：联表时被驱动表用主键或唯一索引匹配，驱动表一行对应被驱动表一行。这是 join 里最好的形态。
- `ref`：普通索引等值匹配，可能命中多行，前面的示例就是。
- `range`：索引上的区间扫描，`>`、`between`、`in`、`like '前缀%'` 都归到这里。它好不好取决于区间宽度——扫 10 行和扫 100 万行都叫 `range`。
- `index`：扫整棵索引树。它比 `ALL` 好一点，因为索引页比数据页窄、一页能放更多条目，但本质仍是全量扫描。看到 `index` 不必高兴，它不等于「精准用到了索引」。
- `ALL`：全表扫描。大表上出现 `ALL`，通常就是这条慢查询的根源。

另外还有 `index_merge`、`unique_subquery`、`index_subquery`、`fulltext` 等取值，出现时说明优化器做了特殊处理，值得单独确认一次是否划算。

`type` 要和 `rows` 一起看：`ref` 扫一百万行照样是慢查询，`ALL` 扫一百行并不值得优化。

## 四、最左前缀与回表，在 EXPLAIN 里长什么样

最左前缀的规则落到 `EXPLAIN` 上只有三个信号：`key` 里出现哪个索引、`key_len` 有多大、`type` 落在哪一档。同一个 `(user_id, status, created_at)`，换一种 `where` 条件，输出就跟着变：

| where 条件 | key | key_len | type | 用到的列 |
| --- | --- | --- | --- | --- |
| `user_id = 1024` | idx_user_status_created | 4 | ref | 第 1 列 |
| `user_id = 1024 and status = 1` | idx_user_status_created | 5 | ref | 前 2 列 |
| `user_id = 1024 and created_at > '2025-11-01'` | idx_user_status_created | 4 | range | 只有第 1 列 |
| `status = 1` | NULL | NULL | ALL | 没有 |

第三行值得停一下：跳过 `status` 之后，`created_at` 也用不上了，`key_len` 退回 4。索引的定位能力必须从最左列开始连续生效，中间断一列，右边的列就只剩过滤作用。

回表在 `EXPLAIN` 里没有对应的列，得自己判断：看 `select` 的列是否都在 `key` 指向的那棵索引里，再看 `Extra` 有没有 `Using index`。

```sql
-- Extra 里会出现 Using index，不回表
explain select user_id, status from orders where user_id = 1024;

-- amount 不在索引里，需要回表
explain select user_id, amount from orders where user_id = 1024;
```

`Using index` 就是覆盖索引的标志：所需列全在二级索引的叶子上，引擎不必再回聚簇索引取整行。前面的示例查的是 `id, user_id, amount`，`amount` 不在索引里，没有 `Using index`，于是每一行都要回表一次——按 `rows` 估算的上千行算，就是上千次额外的聚簇索引查找。

## 五、Extra 与优化的顺序

`Extra` 是最容易被略过、又最能说明问题的一列。几个高频取值：

- `Using where`：server 层在引擎返回行之后还要再过滤一遍。单看它不算坏消息，但和 `ALL` 一起出现，就是「取回全表再筛」。
- `Using index`：覆盖索引，不回表。
- `Using index condition`：索引条件下推（5.6 起），在索引层先按剩余条件过滤，再决定回不回表，通常意味着优化器在省回表次数。
- `Using filesort`：结果不能靠索引顺序直接得到，需要额外排序。名字里有 file 不代表一定写磁盘，结果集小的时候在内存里排；代价是 `rows` 那么多行都要参与排序。
- `Using temporary`：建了内部临时表，常见于 `group by`、`distinct`、`union`，以及 `order by` 的列和 `group by` 的列不一致的时候。临时表可能落盘，一般比 `filesort` 更贵。

于是优化顺序也就清楚了，三步，从便宜到贵：

1. **先看有没有走索引。** `key` 是 `NULL`、`type` 是 `ALL`、`possible_keys` 有值却没选中，都属于这一类。常见原因是列上套了函数、参数类型和列类型不一致（隐式转换）、`like '%x'` 前导模糊，或者没从最左列开始。这些问题大多改 SQL 就能解决，不必动索引结构。
2. **再看排序和临时表。** `Using filesort` 和 `Using temporary` 能不能消掉，取决于索引列顺序能否覆盖 `order by`、`group by`。把排序列接在等值条件列后面、顺序与 `order by` 一致，就能直接沿索引取有序结果。
3. **最后才改 SQL 或者加索引。** 大偏移量 `limit` 改成游标式分页（`where id > ? limit n`），join 让小表驱动大表、在驱动表的连接列上建索引，子查询尽量改写成 join。索引放在最后，因为它是唯一会增加写入成本的手段。

> [!WARNING]
> 加索引不是免费的：占空间、拖慢写入、让优化器在更多执行计划之间做比较。能靠调整现有索引的列顺序解决，就别新建索引；能靠改 SQL 解决，就别动索引结构。

## 自检清单

拿到一条慢查询，按这个顺序过一遍：

- 它在慢日志里属于「次数多」还是「单次慢」？前者看高频路径，后者多半缺索引。
- `type` 落在哪一档？`ALL` 或 `index` 就继续往下追。
- `possible_keys` 有值而 `key` 是 `NULL`，原因是什么：函数、隐式转换、`like '%x'`，还是没从最左列开始？
- `key_len` 是否等于预期列数的字节之和？少了几列，`where` 里是不是跳了列或遇到了范围条件？
- `select` 的列是否都在索引里，`Extra` 有没有 `Using index`？没有的话，回表次数大致等于 `rows`。
- `rows × filtered` 和业务预期的数据量是否差了一个数量级？差得多，先看看统计信息是不是旧了。
- `Extra` 里有没有 `Using filesort` 或 `Using temporary`？`order by`、`group by` 的列顺序能否和索引对齐？
- 动手加索引之前再问一次：能不能改现有索引的列顺序？能不能改 SQL？能不能改查询的粒度？

优化不是把每个 `ALL` 都变成 `ref`，而是让这条语句读的数据量降到它真正需要的程度。`EXPLAIN` 的每一行输出，都是在回答这个问题的某个侧面。
